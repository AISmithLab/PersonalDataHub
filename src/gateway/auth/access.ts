/**
 * Who is calling: the owner or an agent.
 *
 *   /web/*   — owner only: a session cookie, or the device secret on the phone.
 *   /agent/* — an agent key (Authorization: Bearer pk_...), or the owner.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import type { DataStore } from '../../database/datastore.js';

export const SESSION_COOKIE = 'pdh_session';
export const DEVICE_SECRET_HEADER = 'X-PDH-Device-Secret';
export const AGENT_KEY_PREFIX = 'pk_';

export type AccessEnv = { Variables: { caller: string } };

export function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

export function hashAgentKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** A new agent key and the hash to store. The key is shown to the owner once. */
export function newAgentKey(): { key: string; hash: string } {
  const key = AGENT_KEY_PREFIX + randomBytes(32).toString('base64url');
  return { key, hash: hashAgentKey(key) };
}

function matchesDeviceSecret(given: string | undefined): boolean {
  const expected = process.env.PDH_DEVICE_SECRET;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True where this hub authenticates the owner by device secret (the phone app). */
export function usesDeviceSecret(): boolean {
  return !!process.env.PDH_DEVICE_SECRET;
}

/**
 * False when a browser says the request was made by a page from another origin.
 *
 * The session cookie is sent by the browser automatically, and SameSite=Lax does
 * not tell ports apart: a page served from 127.0.0.1:8081 (which a local agent
 * can start) is "same site" as the hub on 127.0.0.1:3000. Without this check such
 * a page could approve an action or create a key with the owner's cookie.
 * Non-browser callers send neither header and are unaffected.
 */
export function isSameOrigin(c: Context): boolean {
  const site = c.req.header('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = c.req.header('Origin');
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    // X-Forwarded-Host covers a hub behind a proxy or CDN that rewrites Host.
    const own = [c.req.header('Host'), c.req.header('X-Forwarded-Host'), new URL(c.req.url).host];
    return own.includes(originHost);
  } catch {
    return false;
  }
}

/** True for a valid session cookie, or the device secret where one is configured. */
export async function isOwner(c: Context, store: DataStore): Promise<boolean> {
  if (matchesDeviceSecret(c.req.header(DEVICE_SECRET_HEADER))) return true;
  const cookie = parseCookie(c.req.header('Cookie') ?? '', SESSION_COOKIE);
  if (!cookie) return false;
  if (!isSameOrigin(c)) return false;
  return (await store.getValidSession(cookie)) !== null;
}

export function requireOwner(store: DataStore): MiddlewareHandler<AccessEnv> {
  return async (c, next) => {
    if (!(await isOwner(c, store))) return c.json({ ok: false, error: 'Unauthorized' }, 401);
    c.set('caller', 'owner');
    await next();
  };
}

export function requireAgent(store: DataStore): MiddlewareHandler<AccessEnv> {
  return async (c, next) => {
    if (await isOwner(c, store)) {
      c.set('caller', 'owner');
      return next();
    }
    const auth = c.req.header('Authorization') ?? '';
    const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (key.startsWith(AGENT_KEY_PREFIX)) {
      const row = await store.getAgentKeyByHash(hashAgentKey(key));
      if (row) {
        await store.touchAgentKey(row.id);
        c.set('caller', row.name);
        return next();
      }
    }
    return c.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid agent key. Create one in Settings and send it as "Authorization: Bearer pk_..."' } },
      401,
    );
  };
}
