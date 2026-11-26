import { Hono, type Context } from 'hono';
import type { DataStore } from '../database/datastore.js';
import type { ConnectorRegistry } from './connectors/types.js';
import type { HubConfigParsed } from '../config/schema.js';
import type { TokenManager } from './auth/token-manager.js';
import { AuditLog } from './audit/log.js';
import { applyFilters, type QuickFilter } from './filters.js';
import { allows, type AccessEnv } from './auth/access.js';
import { AGENT_SOURCES } from './agents.js';

export interface AppApiDeps {
  store: DataStore;
  connectorRegistry: ConnectorRegistry;
  config: HubConfigParsed;
  tokenManager: TokenManager;
}

/** The agent-facing data flow. Mounted at /agent behind requireAgent (see server.ts). */
export function createAppApi(deps: AppApiDeps): Hono<AccessEnv> {
  const app = new Hono<AccessEnv>();
  const auditLog = new AuditLog(deps.store);

  const forbidden = (permission: string) => ({
    ok: false,
    error: { code: 'FORBIDDEN', permission, message: `This agent does not have the "${permission}" permission. The owner can grant it in Settings → Agents.` },
  });

  // A JSON object body, or null. Anything else (invalid JSON, null, an array) is a bad request, not a crash.
  const readBody = async (c: Context<AccessEnv>): Promise<Record<string, unknown> | null> => {
    const parsed = await c.req.json().catch(() => null);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  };
  const badBody = { ok: false, error: { code: 'BAD_REQUEST', message: 'The request body must be a JSON object.' } };

  // Who am I, and what may I do.
  app.get('/me', (c) => {
    const permissions = c.get('permissions');
    return c.json({
      ok: true,
      name: c.get('caller'),
      owner: permissions === null,
      permissions: permissions ?? [...AGENT_SOURCES.map((s) => `pull:${s}`), ...AGENT_SOURCES.map((s) => `propose:${s}`)],
    });
  });

  // An agent removes its own registration (the agent side of "revoke").
  app.post('/leave', async (c) => {
    const agentId = c.get('agentId');
    if (!agentId) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Only a registered agent can leave.' } }, 400);
    await deps.store.deleteAgent(agentId);
    await auditLog.insert('agent_left', null, { id: agentId, name: c.get('caller') });
    return c.json({ ok: true });
  });

  // POST /pull
  app.post('/pull', async (c) => {
    console.log('[app-api] /pull handler entered');
    const body = await readBody(c);
    if (!body) return c.json(badBody, 400);
    console.log('[app-api] /pull body:', JSON.stringify(body));
    const { source, purpose } = body as { source?: unknown; purpose?: unknown };

    if (!purpose) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing required field: purpose' } }, 400);
    }

    if (typeof source !== 'string' || !source) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing required field: source (a string)' } }, 400);
    }
    if (typeof purpose !== 'string') {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'purpose must be a string' } }, 400);
    }

    if (!allows(c, `pull:${source}`)) return c.json(forbidden(`pull:${source}`), 403);

    const sourceConfig = deps.config.sources[source];
    if (!sourceConfig) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: `Unknown source: "${source}"` } }, 404);
    }

    // Fetch live from connector
    const connector = deps.connectorRegistry.get(source);
    if (!connector) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: `No connector for source: "${source}"` } }, 404);
    }

    if (!await deps.tokenManager.hasToken(source)) {
      return c.json({ ok: false, error: { code: 'SOURCE_NOT_CONNECTED', message: `Source "${source}" is not connected. Complete OAuth setup in the GUI first.` } }, 400);
    }

    const boundary = sourceConfig.boundary ?? {};
    const params: Record<string, unknown> = {};
    if (body.query) params.query = body.query;
    if (body.limit) params.limit = body.limit;
    console.log('[app-api] /pull source=%s query=%s limit=%s', source, body.query ?? '(none)', body.limit ?? '(default)');
    const rows = await connector.fetch(boundary, Object.keys(params).length > 0 ? params : undefined);

    // Load enabled filters and apply
    const filters = await deps.store.getEnabledFiltersBySource(source) as QuickFilter[];
    const filtered = applyFilters(rows, filters);

    // Build response
    const responsePayload = {
      ok: true,
      data: filtered,
      meta: { itemsFetched: rows.length, itemsReturned: filtered.length },
    };

    // Log to audit with a clean, readable summary (no raw HTML/JSON blobs)
    const summaryData = filtered.slice(0, 3).map((row) => {
      const d = row.data as Record<string, unknown>;
      const rawBody = typeof d.body === 'string' ? d.body : '';
      const cleanBody = rawBody.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      return {
        from: String(d.author_email || d.author_name || '').slice(0, 100),
        title: String(d.title || '').slice(0, 200),
        snippet: String((d.snippet as string) || cleanBody.slice(0, 150) || '').slice(0, 150),
        date: row.timestamp || '',
      };
    });
    const responseSummary = JSON.stringify({
      ok: true,
      data: summaryData,
      meta: { itemsFetched: rows.length, itemsReturned: filtered.length },
    });
    await auditLog.logPull(source, purpose, filtered.length, c.get('caller') ?? 'agent', responseSummary);

    return c.json(responsePayload);
  });

  // GET /sources — the sources this caller may pull, and whether each is connected
  app.get('/sources', async (c) => {
    const sources: Record<string, { connected: boolean }> = {};
    for (const [name] of deps.connectorRegistry) {
      if (!allows(c, `pull:${name}`)) continue;
      const hasToken = await deps.tokenManager.hasToken(name);
      sources[name] = { connected: hasToken };
    }
    return c.json({ ok: true, sources });
  });

  return app;
}
