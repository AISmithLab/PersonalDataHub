/**
 * Agent registration.
 *
 * The owner makes a one-time join link in Settings → Agents and picks what the
 * agent may do. The agent redeems the link once and receives its token; from then
 * on it sends `Authorization: Bearer pdh_...` on every /agent/* call. The owner
 * never sees or copies a secret, and can change an agent's permissions or revoke
 * it at any time.
 *
 * Two route groups:
 *   owner — mounted at /web/agents behind requireOwner
 *   join  — mounted on /agent *in front of* requireAgent: the agent has no
 *           credential yet, so the one-time code is the protection.
 */

import { Hono } from 'hono';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AgentRow, DataStore, JoinCodeRow } from '../database/datastore.js';
import { AuditLog } from './audit/log.js';
import { newAgentToken, usesDeviceSecret, type AccessEnv } from './auth/access.js';

/** Sources an agent can be given access to. */
export const AGENT_SOURCES = ['gmail', 'google_calendar', 'github', 'photo'] as const;
export const JOIN_CODE_LIFETIME_MS = 15 * 60 * 1000;

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidAgentName(name: unknown): name is string {
  return typeof name === 'string' && NAME_PATTERN.test(name) && name !== 'owner';
}

/**
 * Validates a permission list. Returns it deduplicated in a fixed order
 * (pull before propose, sources in AGENT_SOURCES order), or null if anything in it
 * is not a known `pull:<source>` or `propose:<source>`.
 */
export function normalizePermissions(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const all = [...AGENT_SOURCES.map((s) => `pull:${s}`), ...AGENT_SOURCES.map((s) => `propose:${s}`)];
  for (const p of input) {
    if (typeof p !== 'string' || !all.includes(p)) return null;
  }
  return all.filter((p) => input.includes(p));
}

export function parsePermissions(raw: string): string[] {
  try {
    return normalizePermissions(JSON.parse(raw)) ?? [];
  } catch {
    return [];
  }
}

function describeAgent(a: AgentRow) {
  return { id: a.id, name: a.name, permissions: parsePermissions(a.permissions), created_at: a.created_at, last_used_at: a.last_used_at };
}

function isRedeemable(row: JoinCodeRow | null): row is JoinCodeRow {
  return !!row && !row.used_at && new Date(row.expires_at).getTime() > Date.now();
}

interface AgentDeps {
  store: DataStore;
}

/** Owner routes. Mount at /web/agents. */
export function createAgentOwnerRoutes(deps: AgentDeps): Hono<AccessEnv> {
  const app = new Hono<AccessEnv>();
  const auditLog = new AuditLog(deps.store);

  app.get('/', async (c) => {
    return c.json({ ok: true, agents: (await deps.store.listAgents()).map(describeAgent), sources: AGENT_SOURCES });
  });

  app.post('/join-links', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { permissions?: unknown };
    const permissions = normalizePermissions(body.permissions);
    if (!permissions) return c.json({ ok: false, error: 'permissions must be a list of pull:<source> and propose:<source>' }, 400);
    const code = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + JOIN_CODE_LIFETIME_MS).toISOString();
    await deps.store.insertJoinCode({ code, permissions: JSON.stringify(permissions), expires_at: expiresAt });
    await auditLog.insert('agent_join_link_created', null, { permissions, expires_at: expiresAt });
    return c.json({ ok: true, url: `${new URL(c.req.url).origin}/agent/join/${code}`, permissions, expires_at: expiresAt }, 201);
  });

  app.put('/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({})) as { permissions?: unknown };
    const permissions = normalizePermissions(body.permissions);
    if (!permissions) return c.json({ ok: false, error: 'permissions must be a list of pull:<source> and propose:<source>' }, 400);
    const agent = (await deps.store.listAgents()).find((a) => a.id === id);
    if (!agent) return c.json({ ok: false, error: 'No such agent' }, 404);
    await deps.store.updateAgentPermissions(id, JSON.stringify(permissions));
    await auditLog.insert('agent_permissions_changed', null, { id, name: agent.name, permissions });
    return c.json({ ok: true, agent: { ...describeAgent(agent), permissions } });
  });

  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const agent = (await deps.store.listAgents()).find((a) => a.id === id);
    if (!agent) return c.json({ ok: false, error: 'No such agent' }, 404);
    await deps.store.deleteAgent(id);
    await auditLog.insert('agent_revoked', null, { id, name: agent.name });
    return c.json({ ok: true });
  });

  return app;
}

/** Join routes. Mount on /agent before requireAgent. */
export function createJoinRoutes(deps: AgentDeps): Hono {
  const app = new Hono();
  const auditLog = new AuditLog(deps.store);

  // On the phone no agent runtime can reach the hub, and a route that needs no
  // credential is reachable by any app on the device. Registration is off there.
  app.use('/join/*', async (c, next) => (usesDeviceSecret() ? c.notFound() : next()));
  app.use('/join', async (c, next) => (usesDeviceSecret() ? c.notFound() : next()));

  // For a person who opens the link in a browser. Looking never uses the code up.
  app.get('/join/:code', async (c) => {
    const code = c.req.param('code');
    const row = await deps.store.getJoinCode(code);
    if (!isRedeemable(row)) {
      return c.html(joinPage('<h1>Join link unavailable</h1><p class="err">This link was already used or has expired. Create a new one in the hub under Settings → Agents.</p>'), 410);
    }
    const url = `${new URL(c.req.url).origin}/agent/join/${code}`;
    const grants = parsePermissions(row.permissions).map(esc).join(', ') || 'nothing yet';
    const until = new Date(row.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return c.html(joinPage(
      `<h1>Connect an agent to this PersonalDataHub</h1>
<p>This link registers one agent. It works once and expires at ${esc(until)}.</p>
<p>It grants: <code>${grants}</code></p>
<p>On the machine where the agent runs:</p>
<pre>smithagent joinhub &lt;agent&gt; ${esc(url)}</pre>
<p>Or, without smithagent:</p>
<pre>query-hub join ${esc(url)} --name &lt;name&gt;</pre>`,
    ));
  });

  app.post('/join', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { code?: unknown; name?: unknown };
    const code = typeof body.code === 'string' ? body.code : '';
    const row = code ? await deps.store.getJoinCode(code) : null;
    if (!isRedeemable(row)) {
      return c.json({ ok: false, error: { code: 'GONE', message: 'This join link was already used or has expired. Ask the hub owner for a new one.' } }, 410);
    }
    if (!isValidAgentName(body.name)) {
      return c.json({ ok: false, error: { code: 'INVALID_NAME', message: 'name must be 1-63 characters of a-z, 0-9 and "-", starting with a letter or digit, and not "owner".' } }, 400);
    }
    const name = body.name;
    const taken = { ok: false, error: { code: 'NAME_TAKEN', message: `An agent named "${name}" is already registered with this hub. Choose another name, or revoke the existing one first.` } };
    if ((await deps.store.listAgents()).some((a) => a.name === name)) return c.json(taken, 409);

    // Checks first, so a mistake above leaves the link usable. From here the code is spent.
    if (!(await deps.store.consumeJoinCode(code))) {
      return c.json({ ok: false, error: { code: 'GONE', message: 'This join link was already used or has expired. Ask the hub owner for a new one.' } }, 410);
    }
    const id = `agent_${randomUUID().slice(0, 12)}`;
    const { token, hash } = newAgentToken();
    try {
      await deps.store.insertAgent({ id, name, token_hash: hash, permissions: row.permissions });
    } catch (err) {
      // Whatever went wrong, the agent was not registered: give the link back.
      await deps.store.releaseJoinCode(code);
      // Another agent took the name between the check and the insert.
      if (/unique/i.test(err instanceof Error ? err.message : '')) return c.json(taken, 409);
      throw err;
    }
    const permissions = parsePermissions(row.permissions);
    await auditLog.insert('agent_joined', null, { id, name, permissions });
    return c.json({ ok: true, token, agent_id: id, agent_name: name, permissions, hub: new URL(c.req.url).origin }, 201);
  });

  return app;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function joinPage(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PersonalDataHub — join</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;margin:0;padding:24px;background:#f7f7ff;color:#161d1b}
.card{max-width:640px;margin:8vh auto;background:#fff;border:1px solid #bccac4;border-radius:10px;padding:24px}
h1{font-size:20px;margin:0 0 12px}p{font-size:14px;line-height:1.5}
pre{background:#eef3f1;padding:12px;border-radius:8px;font-size:13px;white-space:pre-wrap;word-break:break-all}code{font-size:13px}
.err{color:#ba1a1a}</style></head><body><div class="card">${body}</div></body></html>`;
}
