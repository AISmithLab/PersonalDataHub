/**
 * Who is calling: the owner or an agent.
 *
 *   /web/*   — owner only: a session cookie, or the device secret on the phone.
 *   /agent/* — a registered agent's token (Authorization: Bearer pdh_...), or the owner.
 *              Agents register through a one-time join link; see ../agents.ts.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import type { DataStore } from '../../database/datastore.js';

export const SESSION_COOKIE = 'pdh_session';
export const DEVICE_SECRET_HEADER = 'X-PDH-Device-Secret';
export const AGENT_TOKEN_PREFIX = 'pdh_';

export type AccessEnv = {
  Variables: {
    /** 'owner', or the agent's name. Recorded in the audit log. */
    caller: string;
    /** What the caller may do on /agent/*. null means the owner: everything. */
    permissions: string[] | null;
    /** Set when the caller is an agent. */
    agentId: string | null;
  };
};

export function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A new agent token and the hash to store. The token is handed to the agent once. */
export function newAgentToken(): { token: string; hash: string } {
  const token = AGENT_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

/** True if the caller may do this on /agent/*. The owner may do everything. */
export function allows(c: Context<AccessEnv>, permission: string): boolean {
  const permissions = c.get('permissions');
  return permissions === null || permissions.includes(permission);
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

function asOwner(c: Context<AccessEnv>): void {
  c.set('caller', 'owner');
  c.set('permissions', null);
  c.set('agentId', null);
}

export function requireOwner(store: DataStore): MiddlewareHandler<AccessEnv> {
  return async (c, next) => {
    if (!(await isOwner(c, store))) return c.json({ ok: false, error: 'Unauthorized' }, 401);
    asOwner(c);
    await next();
  };
}

export function requireAgent(store: DataStore): MiddlewareHandler<AccessEnv> {
  return async (c, next) => {
    if (await isOwner(c, store)) {
      asOwner(c);
      return next();
    }
    const auth = c.req.header('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (token.startsWith(AGENT_TOKEN_PREFIX)) {
      const agent = await store.getAgentByTokenHash(hashToken(token));
      if (agent) {
        await store.touchAgent(agent.id);
        let permissions: string[] = [];
        try {
          const parsed = JSON.parse(agent.permissions);
          if (Array.isArray(parsed)) permissions = parsed.filter((p): p is string => typeof p === 'string');
        } catch { /* no permissions */ }
        c.set('caller', agent.name);
        c.set('permissions', permissions);
        c.set('agentId', agent.id);
        return next();
      }
    }
    return c.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'This agent is not registered with the hub, or it was revoked. Ask the owner for a join link (Settings → Agents).' } },
      401,
    );
  };
}
