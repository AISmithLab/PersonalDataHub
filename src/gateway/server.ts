import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { DataStore } from '../database/datastore.js';
import type { ConnectorRegistry } from './connectors/types.js';
import type { HubConfigParsed } from '../config/schema.js';
import type { TokenManager } from './auth/token-manager.js';
import { createAppApi } from './app-api.js';
import { createChatRoutes } from './chat/routes.js';
import { createGuiRoutes, createPageRoutes } from './gui/routes.js';
import { createOAuthRoutes } from './auth/oauth-routes.js';
import { createLoginRoutes } from './auth/login-routes.js';
import { requireAgent, requireOwner, type AccessEnv } from './auth/access.js';

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
 *   /agent/*  the data flow to agents — an agent key, or the owner.
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
  web.route('/', createChatRoutes(deps));
  web.route('/', createGuiRoutes(deps));
  app.route('/web', web);

  // --- /agent ---
  const agent = new Hono<AccessEnv>();
  agent.use('*', requireAgent(deps.store));
  agent.route('/', createAppApi(deps));
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
