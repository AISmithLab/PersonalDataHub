/**
 * Login routes — email + password authentication (LastPass-style).
 *
 * Mounted at /web/auth. These four routes are the only /web routes that
 * do not require an owner credential.
 *
 * POST /signup — create a new account (only if no users exist)
 * POST /login  — authenticate with email + password
 * POST /logout — end the session
 * GET  /status — is this caller the owner, and does an account exist yet
 *
 * Separate from src/auth/oauth-routes.ts which handles source
 * connections (Gmail API, GitHub API).
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { hashSync, compareSync } from 'bcryptjs';
import type { DataStore } from '../../database/datastore.js';
import { isOwner, isSameOrigin, parseCookie, SESSION_COOKIE, usesDeviceSecret } from './access.js';

interface LoginDeps {
  store: DataStore;
}

export function createLoginRoutes(deps: LoginDeps): Hono {
  const app = new Hono();

  // Account routes are for browsers on the hub's own page.
  //  - On the phone the owner is identified by the device secret and no account
  //    ever exists, so "first signup claims the hub" would let any local app
  //    claim it. Accounts are switched off there.
  //  - A page from another origin must not be able to create or use an account.
  app.use('*', async (c, next) => {
    if (c.req.method !== 'POST') return next();
    if (usesDeviceSecret()) return c.json({ ok: false, error: 'Accounts are not used on this device' }, 404);
    if (!isSameOrigin(c)) return c.json({ ok: false, error: 'Cross-origin request refused' }, 403);
    return next();
  });

  app.post('/signup', async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>();
    const email = body.email?.trim().toLowerCase();
    const password = body.password;

    if (!email || !password) {
      return c.json({ ok: false, error: 'Email and password are required' }, 400);
    }

    if (password.length < 8) {
      return c.json({ ok: false, error: 'Password must be at least 8 characters' }, 400);
    }

    // Only allow signup if no users exist (first-user-claims)
    const userCount = await deps.store.getUserCount();
    if (userCount > 0) {
      return c.json({ ok: false, error: 'An account already exists. Please sign in.' }, 409);
    }

    const passwordHash = hashSync(password, 10);
    await deps.store.createUser(email, passwordHash);

    // Create session
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await deps.store.createSession(token, expiresAt);

    c.header('Set-Cookie', `pdh_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);
    return c.json({ ok: true });
  });

  app.post('/login', async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>();
    const email = body.email?.trim().toLowerCase();
    const password = body.password;

    if (!email || !password) {
      return c.json({ ok: false, error: 'Email and password are required' }, 400);
    }

    const user = await deps.store.getUserByEmail(email);
    if (!user || !compareSync(password, user.password_hash)) {
      return c.json({ ok: false, error: 'Invalid email or password' }, 401);
    }

    // Create session
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await deps.store.createSession(token, expiresAt);

    c.header('Set-Cookie', `pdh_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);
    return c.json({ ok: true });
  });

  app.post('/logout', async (c) => {
    const cookie = parseCookie(c.req.header('Cookie') ?? '', SESSION_COOKIE);
    if (cookie) await deps.store.deleteSession(cookie);
    c.header('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
    return c.json({ ok: true });
  });

  // Also tells the page whether to show "create account" or "sign in".
  app.get('/status', async (c) => {
    const hasUsers = (await deps.store.getUserCount()) > 0;
    // On a device-secret hub there is nothing to sign up for; never offer it.
    return c.json({ authenticated: await isOwner(c, deps.store), hasUsers: hasUsers || usesDeviceSecret() });
  });

  return app;
}
