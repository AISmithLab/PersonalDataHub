import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { DataStore } from '../database/datastore.js';
import type { ConnectorRegistry } from './connectors/types.js';
import type { HubConfigParsed } from '../config/schema.js';
import type { TokenManager } from './auth/token-manager.js';
import { createAppApi } from './app-api.js';
import { createChatRoutes, pipeAsk } from './chat/routes.js';
import { createPipeAgentRoutes, createPipeOwnerRoutes } from './pipes.js';
import { createGuiRoutes, createPageRoutes } from './gui/routes.js';
import { createOAuthRoutes } from './auth/oauth-routes.js';
import { createLoginRoutes } from './auth/login-routes.js';
import { requireAgent, requireOwner, type AccessEnv } from './auth/access.js';
import { createAgentOwnerRoutes, createJoinRoutes } from './agents.js';

export interface ServerDeps {
  store: DataStore;
  connectorRegistry: ConnectorRegistry;
  config: HubConfigParsed;
  tokenManager: TokenManager;
}

/**
 * Route layout. Two prefixes, each with its own credential:
 *
 *   /web/*    the website and the mobile app — owner only (session cookie, or the
 *             device secret on the phone). /web/auth/{signup,login,logout,status}
 *             are the only ones that work before signing in.
 *   /agent/*  the data flow to agents — a registered agent's token, or the owner.
 *             /agent/join and /agent/join/:code are how an agent registers; they
 *             need no token and are protected by the one-time code in the link.
 *
 * Outside the two prefixes, and unauthenticated by necessity:
 *   GET  /health                        liveness ping, no data
 *   GET  /oauth/:source/callback        called by the provider; one-time state
 *   POST /oauth/:source/store-tokens    called by the callback page; one-time ticket
 *   GET  /, /next                       the pages themselves
 */
export function createServer(deps: ServerDeps): Hono {
  const app = new Hono();

  // Health check — CORS wildcard so the Capacitor WebView (origin: http://localhost)
  // can poll this endpoint from www/index.html before navigating to the server.
  app.get('/health', (c) => {
    c.header('Access-Control-Allow-Origin', '*');
    return c.json({ ok: true, version: '0.1.0' });
  });

  const oauth = createOAuthRoutes(deps);
  const pipeDeps = { ...deps, ask: pipeAsk(deps) };
  app.route('/oauth', oauth.pub);

  // --- /web ---
  const web = new Hono<AccessEnv>();
  web.route('/auth', createLoginRoutes({ store: deps.store }));
  const ownerOnly = requireOwner(deps.store);
  web.use('*', async (c, next) => {
    if (c.req.path.startsWith('/web/auth/')) return next();
    return ownerOnly(c, next);
  });
  web.route('/oauth', oauth.owner);
  web.route('/agents', createAgentOwnerRoutes(deps));
  web.route('/pipes', createPipeOwnerRoutes(pipeDeps));
  web.route('/', createChatRoutes(deps));
  web.route('/', createGuiRoutes(deps));
  app.route('/web', web);

  // --- /agent ---
  const agent = new Hono<AccessEnv>();
  // Registration comes first: an agent redeeming a join link has no token yet.
  agent.route('/', createJoinRoutes(deps));
  agent.use('*', requireAgent(deps.store));
  agent.route('/', createAppApi(deps));
  agent.route('/', createPipeAgentRoutes(pipeDeps));
  app.route('/agent', agent);

  // Pages (last)
  app.route('/', createPageRoutes());

  return app;
}

export function startServer(deps: ServerDeps): void {
  const app = createServer(deps);
  const port = deps.config.port ?? 3000;

  serve({
    fetch: app.fetch,
    hostname: '127.0.0.1',
    port,
  });

  console.log(`PersonalDataHub server listening on http://127.0.0.1:${port}`);
}
