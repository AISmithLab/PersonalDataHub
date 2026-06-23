import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { google } from 'googleapis';
import type { DataStore } from '../../database/datastore.js';
import type { ConnectorRegistry } from '../connectors/types.js';
import type { HubConfigParsed } from '../../config/schema.js';
import type { TokenManager } from './token-manager.js';
import { AuditLog } from '../audit/log.js';
import { GmailConnector } from '../connectors/gmail/connector.js';
import { GoogleCalendarConnector } from '../connectors/calendar/connector.js';
import { GitHubConnector } from '../connectors/github/connector.js';
import { generateCodeVerifier, computeCodeChallenge, getGmailCredentials, getGitHubCredentials, getCalendarCredentials } from './pkce.js';

interface OAuthDeps {
  store: DataStore;
  connectorRegistry: ConnectorRegistry;
  config: HubConfigParsed;
  tokenManager: TokenManager;
}

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
];

const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

export function getBaseUrl(config: HubConfigParsed): string {
  if (config.deployment?.base_url) return config.deployment.base_url;
  const port = config.port ?? 3000;
  return `http://127.0.0.1:${port}`;
}

/**
 * Serve an HTML page that does the OAuth token exchange in the browser.
 *
 * nodejs-mobile cannot make outbound HTTPS calls (DNS/network unavailable from
 * its thread context). The system browser that handled Google/GitHub auth CAN
 * reach external servers, so we hand the exchange off to it:
 *   1. Browser fetches tokens from the provider.
 *   2. Browser POSTs tokens to our local store-tokens endpoint (same-origin, no CORS).
 *   3. Browser navigates to the pdh:// deep link, which Android routes back to the app.
 */
function buildExchangePage(opts: {
  tokenUrl: string;
  tokenBody: Record<string, string>;
  tokenHeaders?: Record<string, string>;
  userinfoUrl?: string;
  storeUrl: string;
  successScheme: string;
  baseUrl: string;
}): string {
  const errorRedirect = `${opts.baseUrl}/?oauth_error=`;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Signing in…</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;
justify-content:center;min-height:100vh;margin:0;background:#0f1117;color:#e2e8f0;
text-align:center;padding:24px;box-sizing:border-box}
p{font-size:16px;line-height:1.5}
</style>
</head>
<body>
<p id="msg">Completing sign-in&hellip;</p>
<script>
(async function(){
  var msg=document.getElementById('msg');
  try{
    var tokenResp=await fetch(${JSON.stringify(opts.tokenUrl)},{
      method:'POST',
      headers:Object.assign({'Content-Type':'application/x-www-form-urlencoded'},${JSON.stringify(opts.tokenHeaders ?? {})}),
      body:new URLSearchParams(${JSON.stringify(opts.tokenBody)}).toString()
    });
    var tokens=await tokenResp.json();
    if(tokens.error) throw new Error(tokens.error_description||tokens.error);

    var userinfo={};
    if(${JSON.stringify(opts.userinfoUrl??'')} && tokens.access_token){
      try{
        var uiResp=await fetch(${JSON.stringify(opts.userinfoUrl??'')},{
          headers:{Authorization:'Bearer '+tokens.access_token}
        });
        userinfo=await uiResp.json();
      }catch(e){}
    }

    var storeResp=await fetch(${JSON.stringify(opts.storeUrl)},{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({tokens:tokens,userinfo:userinfo})
    });
    var stored=await storeResp.json();
    if(!stored.ok) throw new Error(stored.error||'Failed to store tokens');

    msg.textContent='Sign-in complete! Returning to app…';
    window.location.href=${JSON.stringify(opts.successScheme)};
  }catch(e){
    msg.textContent='Error: '+e.message+'. Returning to app…';
    setTimeout(function(){
      window.location.href=${JSON.stringify(errorRedirect)}+encodeURIComponent(e.message);
    },2000);
  }
})();
</script>
</body>
</html>`;
}

export function createOAuthRoutes(deps: OAuthDeps): Hono {
  const app = new Hono();
  const auditLog = new AuditLog(deps.store);

  // --- Gmail OAuth ---

  app.get('/gmail/start', async (c) => {
    const gmailConfig = deps.config.sources.gmail;
    if (!gmailConfig) {
      return c.redirect('/?oauth_error=gmail_not_configured');
    }

    const { clientId, clientSecret } = getGmailCredentials(deps.config);
    if (!clientId || !clientSecret) {
      return c.redirect('/?oauth_error=gmail_missing_credentials');
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = computeCodeChallenge(codeVerifier);

    const state = randomBytes(32).toString('hex');
    await deps.store.setOAuthState(state, { source: 'gmail', createdAt: Date.now(), codeVerifier });

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      `${getBaseUrl(deps.config)}/oauth/gmail/callback`,
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GMAIL_SCOPES,
      state,
      code_challenge: codeChallenge,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      code_challenge_method: 'S256' as any,
    });

    return c.redirect(authUrl);
  });

  // Callback: validate CSRF state, then serve an HTML page that does the token
  // exchange in the browser (nodejs-mobile cannot make outbound HTTPS calls).
  app.get('/gmail/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    if (error) return c.redirect(`/?oauth_error=${encodeURIComponent(error)}`);
    if (!code || !state) return c.redirect('/?oauth_error=missing_code_or_state');

    const pending = await deps.store.getAndDeleteOAuthState(state);
    if (!pending || pending.source !== 'gmail') {
      return c.redirect('/?oauth_error=invalid_state');
    }

    const { clientId, clientSecret } = getGmailCredentials(deps.config);
    const baseUrl = getBaseUrl(deps.config);

    return c.html(buildExchangePage({
      tokenUrl: 'https://oauth2.googleapis.com/token',
      tokenBody: {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${baseUrl}/oauth/gmail/callback`,
        grant_type: 'authorization_code',
        code_verifier: pending.codeVerifier,
      },
      userinfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
      storeUrl: `${baseUrl}/oauth/gmail/store-tokens`,
      successScheme: 'pdh://oauth?success=gmail',
      baseUrl,
    }));
  });

  // Receives tokens from the browser-side exchange and stores them server-side.
  // Reachable from the system browser because it navigates to http://127.0.0.1:3000
  // (same origin as store-tokens), so no CORS headers needed.
  app.post('/gmail/store-tokens', async (c) => {
    const body = await c.req.json() as { tokens: Record<string, unknown>; userinfo: Record<string, unknown> };
    const { tokens, userinfo } = body;

    if (!tokens?.access_token) {
      return c.json({ ok: false, error: 'No access_token in payload' }, 400);
    }

    const { clientId, clientSecret } = getGmailCredentials(deps.config);

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString()
      : tokens.expiry_date
        ? new Date(Number(tokens.expiry_date)).toISOString()
        : undefined;

    await deps.tokenManager.storeToken('gmail', {
      access_token: String(tokens.access_token),
      refresh_token: tokens.refresh_token ? String(tokens.refresh_token) : undefined,
      token_type: tokens.token_type ? String(tokens.token_type) : 'Bearer',
      expires_at: expiresAt,
      scopes: GMAIL_SCOPES.join(' '),
      account_info: {
        email: userinfo?.email ? String(userinfo.email) : undefined,
        name: userinfo?.name ? String(userinfo.name) : undefined,
        picture: userinfo?.picture ? String(userinfo.picture) : undefined,
      },
    });

    const connector = new GmailConnector({
      clientId,
      clientSecret,
      accessToken: String(tokens.access_token),
      refreshToken: tokens.refresh_token ? String(tokens.refresh_token) : undefined,
    });
    deps.connectorRegistry.set('gmail', connector);

    connector.getAuth().on('tokens', async (newTokens) => {
      if (newTokens.access_token) {
        const newExpiry = newTokens.expiry_date
          ? new Date(newTokens.expiry_date).toISOString()
          : undefined;
        await deps.tokenManager.updateAccessToken('gmail', newTokens.access_token, newExpiry);
      }
    });

    await auditLog.insert('oauth_connected', 'gmail', { email: userinfo?.email });
    return c.json({ ok: true });
  });

  app.post('/gmail/disconnect', async (c) => {
    await deps.tokenManager.deleteToken('gmail');
    deps.connectorRegistry.delete('gmail');
    await auditLog.insert('oauth_disconnected', 'gmail', {});
    return c.json({ ok: true });
  });

  // --- Google Calendar OAuth ---

  app.get('/google_calendar/start', async (c) => {
    const calConfig = deps.config.sources.google_calendar;
    if (!calConfig) {
      return c.redirect('/?oauth_error=calendar_not_configured');
    }

    const { clientId, clientSecret } = getCalendarCredentials(deps.config);
    if (!clientId || !clientSecret) {
      return c.redirect('/?oauth_error=calendar_missing_credentials');
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = computeCodeChallenge(codeVerifier);

    const state = randomBytes(32).toString('hex');
    await deps.store.setOAuthState(state, { source: 'google_calendar', createdAt: Date.now(), codeVerifier });

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      `${getBaseUrl(deps.config)}/oauth/google_calendar/callback`,
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: CALENDAR_SCOPES,
      state,
      code_challenge: codeChallenge,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      code_challenge_method: 'S256' as any,
    });

    return c.redirect(authUrl);
  });

  app.get('/google_calendar/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    if (error) return c.redirect(`/?oauth_error=${encodeURIComponent(error)}`);
    if (!code || !state) return c.redirect('/?oauth_error=missing_code_or_state');

    const pending = await deps.store.getAndDeleteOAuthState(state);
    if (!pending || pending.source !== 'google_calendar') {
      return c.redirect('/?oauth_error=invalid_state');
    }

    const { clientId, clientSecret } = getCalendarCredentials(deps.config);
    const baseUrl = getBaseUrl(deps.config);

    return c.html(buildExchangePage({
      tokenUrl: 'https://oauth2.googleapis.com/token',
      tokenBody: {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${baseUrl}/oauth/google_calendar/callback`,
        grant_type: 'authorization_code',
        code_verifier: pending.codeVerifier,
      },
      storeUrl: `${baseUrl}/oauth/google_calendar/store-tokens`,
      successScheme: 'pdh://oauth?success=google_calendar',
      baseUrl,
    }));
  });

  app.post('/google_calendar/store-tokens', async (c) => {
    const body = await c.req.json() as { tokens: Record<string, unknown>; userinfo: Record<string, unknown> };
    const { tokens } = body;

    if (!tokens?.access_token) {
      return c.json({ ok: false, error: 'No access_token in payload' }, 400);
    }

    const { clientId, clientSecret } = getCalendarCredentials(deps.config);

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString()
      : tokens.expiry_date
        ? new Date(Number(tokens.expiry_date)).toISOString()
        : undefined;

    await deps.tokenManager.storeToken('google_calendar', {
      access_token: String(tokens.access_token),
      refresh_token: tokens.refresh_token ? String(tokens.refresh_token) : undefined,
      token_type: tokens.token_type ? String(tokens.token_type) : 'Bearer',
      expires_at: expiresAt,
      scopes: CALENDAR_SCOPES.join(' '),
    });

    const connector = new GoogleCalendarConnector({
      clientId,
      clientSecret,
      accessToken: String(tokens.access_token),
      refreshToken: tokens.refresh_token ? String(tokens.refresh_token) : undefined,
    });
    deps.connectorRegistry.set('google_calendar', connector);

    connector.getAuth().on('tokens', async (newTokens) => {
      if (newTokens.access_token) {
        const newExpiry = newTokens.expiry_date
          ? new Date(newTokens.expiry_date).toISOString()
          : undefined;
        await deps.tokenManager.updateAccessToken('google_calendar', newTokens.access_token, newExpiry);
      }
    });

    await auditLog.insert('oauth_connected', 'google_calendar', {});
    return c.json({ ok: true });
  });

  app.post('/google_calendar/disconnect', async (c) => {
    await deps.tokenManager.deleteToken('google_calendar');
    deps.connectorRegistry.delete('google_calendar');
    await auditLog.insert('oauth_disconnected', 'google_calendar', {});
    return c.json({ ok: true });
  });

  // --- GitHub OAuth ---

  app.get('/github/start', async (c) => {
    const githubConfig = deps.config.sources.github;
    if (!githubConfig) {
      return c.redirect('/?oauth_error=github_not_configured');
    }

    const { clientId } = getGitHubCredentials(deps.config);
    if (!clientId) {
      return c.redirect('/?oauth_error=github_missing_credentials');
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = computeCodeChallenge(codeVerifier);

    const state = randomBytes(32).toString('hex');
    await deps.store.setOAuthState(state, { source: 'github', createdAt: Date.now(), codeVerifier });

    const redirectUri = `${getBaseUrl(deps.config)}/oauth/github/callback`;
    const authUrl =
      `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}` +
      `&code_challenge=${encodeURIComponent(codeChallenge)}` +
      `&code_challenge_method=S256`;

    return c.redirect(authUrl);
  });

  app.get('/github/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    if (error) return c.redirect(`/?oauth_error=${encodeURIComponent(error)}`);
    if (!code || !state) return c.redirect('/?oauth_error=missing_code_or_state');

    const pending = await deps.store.getAndDeleteOAuthState(state);
    if (!pending || pending.source !== 'github') {
      return c.redirect('/?oauth_error=invalid_state');
    }

    const { clientId, clientSecret } = getGitHubCredentials(deps.config);
    const baseUrl = getBaseUrl(deps.config);

    return c.html(buildExchangePage({
      tokenUrl: 'https://github.com/login/oauth/access_token',
      tokenBody: {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: pending.codeVerifier,
      },
      tokenHeaders: { Accept: 'application/json' },
      userinfoUrl: 'https://api.github.com/user',
      storeUrl: `${baseUrl}/oauth/github/store-tokens`,
      successScheme: 'pdh://oauth?success=github',
      baseUrl,
    }));
  });

  app.post('/github/store-tokens', async (c) => {
    const body = await c.req.json() as { tokens: Record<string, unknown>; userinfo: Record<string, unknown> };
    const { tokens, userinfo } = body;

    if (!tokens?.access_token) {
      return c.json({ ok: false, error: tokens?.error_description ?? tokens?.error ?? 'No access_token' }, 400);
    }

    const githubConfig = deps.config.sources.github;
    const { clientId, clientSecret } = getGitHubCredentials(deps.config);

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString()
      : undefined;

    await deps.tokenManager.storeToken('github', {
      access_token: String(tokens.access_token),
      refresh_token: tokens.refresh_token ? String(tokens.refresh_token) : undefined,
      token_type: tokens.token_type ? String(tokens.token_type) : 'Bearer',
      expires_at: expiresAt,
      scopes: tokens.scope ? String(tokens.scope) : '',
      account_info: {
        login: userinfo?.login ? String(userinfo.login) : undefined,
        name: userinfo?.name ? String(userinfo.name) : undefined,
        avatar_url: userinfo?.avatar_url ? String(userinfo.avatar_url) : undefined,
        html_url: userinfo?.html_url ? String(userinfo.html_url) : undefined,
      },
    });

    const allowedRepos = githubConfig?.boundary.repos ?? [];
    const connector = new GitHubConnector({
      ownerToken: String(tokens.access_token),
      agentUsername: githubConfig?.agent_identity?.github_username ?? '',
      allowedRepos,
    });
    deps.connectorRegistry.set('github', connector);

    await auditLog.insert('oauth_connected', 'github', { login: userinfo?.login });
    return c.json({ ok: true });
  });

  app.post('/github/disconnect', async (c) => {
    await deps.tokenManager.deleteToken('github');
    deps.connectorRegistry.delete('github');
    await auditLog.insert('oauth_disconnected', 'github', {});
    return c.json({ ok: true });
  });

  return app;
}
