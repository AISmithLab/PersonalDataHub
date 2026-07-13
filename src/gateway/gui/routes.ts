import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { DataStore } from '../../database/datastore.js';
import type { ConnectorRegistry } from '../connectors/types.js';
import type { HubConfigParsed } from '../../config/schema.js';
import type { TokenManager } from '../auth/token-manager.js';
import { google } from 'googleapis';
import { AuditLog } from '../audit/log.js';
import { GmailConnector } from '../connectors/gmail/connector.js';
import { GoogleCalendarConnector } from '../connectors/calendar/connector.js';
import { GitHubConnector } from '../connectors/github/connector.js';
import { Octokit } from 'octokit';
import { FILTER_TYPES, applyFilters, type QuickFilter } from '../filters.js';
import { getClient, getModel } from '../chat/routes.js';

interface GuiDeps {
  store: DataStore;
  connectorRegistry: ConnectorRegistry;
  config: HubConfigParsed;
  tokenManager: TokenManager;
}

export function createGuiRoutes(deps: GuiDeps): Hono {
  const app = new Hono();
  const auditLog = new AuditLog(deps.store);

  // Serve the SPA
  app.get('/', (c) => {
    return c.html(getIndexHtml());
  });

  app.post('/api/error-log', async (c) => {
    try {
      const body = await c.req.json();
      const fs = await import('node:fs');
      const path = await import('node:path');
      const logDir = '/home/goose/projects/PersonalDataHub/scratch';
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(
        path.join(logDir, 'browser_errors.log'),
        `[${new Date().toISOString()}] Message: ${body.message}\nSource: ${body.source}:${body.lineno}:${body.colno}\nStack: ${body.stack}\n\n`
      );
    } catch (e) {
      console.error('Failed to log browser error:', e);
    }
    return c.json({ ok: true });
  });

  // --- Auth endpoints (before middleware) ---

  // Auth status check — also tells frontend if signup is needed
  app.get('/api/auth/status', async (c) => {
    const cookie = parseCookie(c.req.header('Cookie') ?? '', 'pdh_session');
    const hasUsers = (await deps.store.getUserCount()) > 0;
    if (!cookie) return c.json({ authenticated: false, hasUsers });
    const session = await deps.store.getValidSession(cookie);
    return c.json({ authenticated: !!session, hasUsers });
  });

  // Logout
  app.post('/api/logout', async (c) => {
    const cookie = parseCookie(c.req.header('Cookie') ?? '', 'pdh_session');
    if (cookie) {
      await deps.store.deleteSession(cookie);
    }
    c.header('Set-Cookie', 'pdh_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
    return c.json({ ok: true });
  });

  // Session auth middleware for all /api/* routes below
  app.use('/api/*', async (c, next) => {
    const cookie = parseCookie(c.req.header('Cookie') ?? '', 'pdh_session');
    if (!cookie) return c.json({ ok: false, error: 'Unauthorized' }, 401);
    const session = await deps.store.getValidSession(cookie);
    if (!session) return c.json({ ok: false, error: 'Unauthorized' }, 401);
    await next();
  });

  // --- GUI API endpoints (protected by session middleware) ---

  // Get all sources and their status
  app.get('/api/sources', async (c) => {
    const sources = await Promise.all(Object.entries(deps.config.sources).map(async ([name, config]) => ({
      name,
      enabled: config.enabled,
      boundary: config.boundary,
      connected: await deps.tokenManager.hasToken(name),
      accountInfo: await deps.tokenManager.getAccountInfo(name),
    })));

    // Backfill Gmail account info if empty
    const gmailSource = sources.find((s) => s.name === 'gmail' && s.connected);
    if (gmailSource && (!gmailSource.accountInfo || !gmailSource.accountInfo.email)) {
      const connector = deps.connectorRegistry.get('gmail');
      if (connector && connector instanceof GmailConnector) {
        try {
          const gmailApi = google.gmail({ version: 'v1', auth: connector.getAuth() });
          const profile = await gmailApi.users.getProfile({ userId: 'me' });
          const info = { email: profile.data.emailAddress ?? undefined };
          await deps.tokenManager.updateAccountInfo('gmail', info);
          gmailSource.accountInfo = info;
        } catch (_) { /* non-fatal */ }
      }
    }

    // Backfill Calendar account info if empty
    const calSource = sources.find((s) => s.name === 'google_calendar' && s.connected);
    if (calSource && (!calSource.accountInfo || !calSource.accountInfo.email)) {
      const connector = deps.connectorRegistry.get('google_calendar');
      if (connector && connector instanceof GoogleCalendarConnector) {
        try {
          const calApi = google.calendar({ version: 'v3', auth: connector.getAuth() });
          const profile = await calApi.calendarList.get({ calendarId: 'primary' });
          const info = { email: profile.data.id ?? undefined };
          await deps.tokenManager.updateAccountInfo('google_calendar', info);
          calSource.accountInfo = info;
        } catch (_) { /* non-fatal */ }
      }
    }

    return c.json({ ok: true, sources });
  });

  // Get filters for a source
  app.get('/api/filters', async (c) => {
    const source = c.req.query('source');
    const filters = source
      ? await deps.store.getFiltersBySource(source)
      : await deps.store.getAllFilters();
    return c.json({ ok: true, filters, filterTypes: FILTER_TYPES });
  });

  // Create or update a filter
  app.post('/api/filters', async (c) => {
    const body = await c.req.json();
    const { id, source, type, value, enabled } = body;

    if (!source || !type) {
      return c.json({ ok: false, error: 'source and type are required' }, 400);
    }

    if (id) {
      // Update existing filter
      await deps.store.updateFilter(id, value ?? '', enabled ?? 1);
      return c.json({ ok: true, id });
    }

    // Create new filter
    const newId = `filter_${randomUUID().slice(0, 12)}`;
    await deps.store.createFilter({ id: newId, source, type, value: value ?? '', enabled: enabled ?? 1 });
    return c.json({ ok: true, id: newId });
  });

  // Delete a filter
  app.delete('/api/filters/:id', async (c) => {
    const id = c.req.param('id');
    await deps.store.deleteFilter(id);
    return c.json({ ok: true });
  });

  // Get staging queue
  app.get('/api/staging', async (c) => {
    const actions = await deps.store.getAllStagingActions();
    return c.json({ ok: true, actions });
  });

  // Approve/reject a staged action
  app.post('/api/staging/:actionId/resolve', async (c) => {
    const actionId = c.req.param('actionId');
    const body = await c.req.json();
    const { decision } = body; // 'approve' or 'reject'

    const action = await deps.store.getStagingAction(actionId);
    const actionSource = action?.source || null;

    const status = decision === 'approve' ? 'approved' : 'rejected';
    await deps.store.updateStagingStatus(actionId, status);

    if (decision === 'approve') {
      await auditLog.logActionApproved(actionId, 'owner', actionSource ?? undefined);

      // Execute the action via connector
      if (action) {
        const connector = deps.connectorRegistry.get(action.source);
        if (connector) {
          try {
            const actionData = JSON.parse(action.action_data);
            let actionType = action.action_type;

            // If it's a gmail source and the user clicked 'Send' (which sets send: true in action_data),
            // we override the actionType to 'send_email'.
            if (action.source === 'gmail' && actionData.send) {
              actionType = 'send_email';
            }

            const result = await connector.executeAction(
              actionType,
              actionData,
            );
            await deps.store.updateStagingStatus(actionId, 'committed');
            await auditLog.logActionCommitted(actionId, action.source, result.success ? 'success' : 'failure');
          } catch (_err) {
            await auditLog.logActionCommitted(actionId, action.source, 'failure');
          }
        }
      }
    } else {
      await auditLog.logActionRejected(actionId, 'owner', actionSource ?? undefined);
    }

    return c.json({ ok: true, status });
  });

  // Get single staging action
  app.get('/api/staging/:actionId', async (c) => {
    const actionId = c.req.param('actionId');
    const action = await deps.store.getStagingAction(actionId);
    if (!action) return c.json({ ok: false, error: 'Not found' }, 404);
    try {
      return c.json({ ok: true, action: { ...action, action_data: JSON.parse(action.action_data) } });
    } catch {
      return c.json({ ok: true, action });
    }
  });

  // Edit staging action data (only when pending)
  app.post('/api/staging/:actionId/edit', async (c) => {
    const actionId = c.req.param('actionId');
    const body = await c.req.json();
    const action = await deps.store.getStagingAction(actionId);
    if (!action) return c.json({ ok: false, error: 'Not found' }, 404);
    if (action.status !== 'pending') return c.json({ ok: false, error: 'Action is not pending' }, 400);
    const existing = JSON.parse(action.action_data);
    const merged = { ...existing, ...body.action_data };
    await deps.store.updateStagingActionData(actionId, JSON.stringify(merged));
    return c.json({ ok: true, action_data: merged });
  });

  // Get audit log
  app.get('/api/audit', async (c) => {
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const event = c.req.query('event');
    const source = c.req.query('source');

    const entries = await auditLog.getEntries({ event: event ?? undefined, source: source ?? undefined, limit });
    return c.json({ ok: true, entries });
  });

  app.delete('/api/audit', async (c) => {
    await auditLog.clearAll();
    return c.json({ ok: true });
  });

  // --- Agent Skills endpoints ---

  app.get('/api/skills', async (c) => {
    const skills = await deps.store.listSkills();
    return c.json({ ok: true, skills });
  });

  app.post('/api/skills', async (c) => {
    const body = await c.req.json() as { name?: string; instructions?: string; trigger_event?: string; current_view?: string; logic_tree?: string };
    if (!body.name?.trim()) return c.json({ ok: false, error: 'name is required' }, 400);
    const id = `skill_${randomUUID().slice(0, 12)}`;
    await deps.store.insertSkill({
      id,
      name: body.name.trim(),
      instructions: body.instructions ?? '',
      trigger_event: body.trigger_event ?? 'sms_received',
      enabled: 0,
      current_view: body.current_view ?? 'SUMMARIZED',
      logic_tree: body.logic_tree ?? '[]'
    });
    return c.json({ ok: true, id });
  });

  app.put('/api/skills/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json() as { name?: string; instructions?: string; trigger_event?: string; activate?: boolean; current_view?: string; logic_tree?: string };
    if (body.activate) {
      const skill = (await deps.store.listSkills()).find(s => s.id === id);
      if (skill) await deps.store.activateSkill(id, body.trigger_event ?? skill.trigger_event);
    } else {
      await deps.store.updateSkill(id, {
        name: body.name,
        instructions: body.instructions,
        trigger_event: body.trigger_event,
        current_view: body.current_view,
        logic_tree: body.logic_tree
      });
    }
    return c.json({ ok: true });
  });

  app.delete('/api/skills/:id', async (c) => {
    const id = c.req.param('id');
    await deps.store.deleteSkill(id);
    return c.json({ ok: true });
  });

  app.post('/api/skills/translate/logical-to-summarized', async (c) => {
    try {
      const body = await c.req.json() as { logicTree: any[] };
      const logicTree = body.logicTree || [];
      const client = getClient(deps as any);
      const model = getModel(deps as any);
      
      const response = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: `You are an expert technical writer. You will receive a JSON array representing a logical decision tree (IF/ELIF/ELSE/CONTEXT). Your task is to translate this exact logic into a single, cohesive, easy-to-read natural language paragraph. Do not drop any conditions, actions, or context blocks. For CONTEXT blocks, present them as background guidelines or context instructions (e.g. starting with "Context: [instruction]" or "Before replying, [instruction]"). Use clear transition words (If, Alternatively, Otherwise). Return ONLY the natural language text.`
          },
          {
            role: 'user',
            content: JSON.stringify(logicTree, null, 2)
          }
        ],
        max_tokens: 1000
      });
      const nlSummary = response.choices[0]?.message?.content?.trim() ?? '';
      return c.json({ ok: true, nlSummary });
    } catch (e: any) {
      return c.json({ ok: false, error: e.message || String(e) }, 500);
    }
  });

  app.post('/api/skills/translate/summarized-to-logical', async (c) => {
    try {
      const body = await c.req.json() as { nlSummary: string };
      const nlSummary = body.nlSummary || '';
      
      if (!nlSummary.trim()) {
        return c.json({ ok: true, logicTree: [{ id: 'node_' + randomUUID().slice(0, 8), type: 'IF', condition: '', action: '' }] });
      }
 
      const client = getClient(deps as any);
      const model = getModel(deps as any);
      
      const response = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a JSON parser. You will receive a natural language description of a logical workflow. Your task is to extract the conditional statements, actions, and background context instructions and format them STRICTLY as a JSON array of objects.

Required Schema:
[{ "type": "IF" | "ELIF" | "ELSE" | "CONTEXT", "condition": "string | null", "action": "string" }]

Rules:
1. Background context guidelines or instructions that are not conditional (e.g. "Check the SMS thread history...", "Context: ...", "Before replying, ...") MUST be formatted as type "CONTEXT" with condition set to null and the background instruction as the action.
2. The first conditional statement MUST be "IF".
3. Subsequent conditional statements MUST be "ELIF".
4. A fallback/catch-all action MUST be "ELSE", and its "condition" MUST be null.
5. Keep the extracted strings for condition, action, or context concise.
6. Output ONLY valid JSON. No markdown formatting, no explanations.`
          },
          {
            role: 'user',
            content: nlSummary
          }
        ],
        max_tokens: 1000
      });
      const text = response.choices[0]?.message?.content?.trim() ?? '';
      const jsonText = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      let logicTree: any[];
      try {
        logicTree = JSON.parse(jsonText);
        if (!Array.isArray(logicTree)) throw new Error('Not an array');
        logicTree = logicTree.map((node: any, idx: number) => ({
          id: node.id || `node_${randomUUID().slice(0, 8)}_${idx}`,
          type: node.type || (idx === 0 ? 'IF' : idx === logicTree.length - 1 ? 'ELSE' : 'ELIF'),
          condition: (node.type === 'ELSE' || node.type === 'CONTEXT') ? null : node.condition || '',
          action: node.action || ''
        }));
      } catch (err) {
        return c.json({ ok: false, error: 'Could not parse logic from text. Ensure the natural language has clear conditional logic.' }, 400);
      }
      return c.json({ ok: true, logicTree });
    } catch (e: any) {
      return c.json({ ok: false, error: e.message || String(e) }, 500);
    }
  });

  // --- GitHub repo discovery endpoints ---

  // Fetch all repos from GitHub API, upsert into DB, return with selection state
  app.get('/api/github/repos', async (c) => {
    const storedToken = await deps.tokenManager.getToken('github');
    if (!storedToken) {
      return c.json({ ok: false, error: 'GitHub not connected' }, 401);
    }

    try {
      const octokit = new Octokit({ auth: storedToken.access_token });

      // Paginate to get all accessible repos (owned + collaborated)
      const userRepos = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
        per_page: 100,
        type: 'all',
        sort: 'full_name',
      });

      // Also fetch repos from each org the user belongs to
      const orgs = await octokit.paginate(octokit.rest.orgs.listForAuthenticatedUser, { per_page: 100 });
      const orgRepoLists = await Promise.all(
        orgs.map(org => octokit.paginate(octokit.rest.repos.listForOrg, { org: org.login, per_page: 100, type: 'all' }))
      );

      // Deduplicate by full_name
      const seen = new Set<string>();
      const repos = [...userRepos, ...orgRepoLists.flat()].filter(r => {
        if (seen.has(r.full_name)) return false;
        seen.add(r.full_name);
        return true;
      });

      // Upsert each repo into github_repos, preserving existing enabled/permissions
      await deps.store.upsertGitHubRepos(repos.map(repo => ({
        full_name: repo.full_name,
        owner: repo.owner.login,
        name: repo.name,
        isPrivate: repo.private,
        description: repo.description ?? '',
        isOrg: repo.owner.type === 'Organization',
      })));

      // Return all repos from DB with their selection state
      const allRepos = await deps.store.getAllGitHubRepos();

      return c.json({ ok: true, repos: allRepos });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      return c.json({ ok: false, error: message }, 500);
    }
  });

  // Save user's repo selection and permissions
  app.post('/api/github/repos', async (c) => {
    const body = await c.req.json() as {
      repos: Record<string, { enabled: boolean; permissions: string[] }>;
    };

    if (!body.repos || typeof body.repos !== 'object') {
      return c.json({ ok: false, error: 'Invalid body' }, 400);
    }

    const updates = Object.entries(body.repos).map(([fullName, settings]) => ({
      full_name: fullName,
      enabled: settings.enabled,
      permissions: JSON.stringify(settings.permissions),
    }));
    await deps.store.updateGitHubRepoSettings(updates);

    // Rebuild allowed repos and update connector
    const enabledRepos = await deps.store.getEnabledGitHubRepos();
    const enabledNames = enabledRepos.map((r) => r.full_name);

    const connector = deps.connectorRegistry.get('github');
    if (connector && connector instanceof GitHubConnector) {
      connector.updateAllowedRepos(enabledNames);
    }

    return c.json({ ok: true });
  });

  // Fetch real calendar events from connected account
  app.get('/api/calendar/events', async (c) => {
    const connector = deps.connectorRegistry.get('google_calendar');
    if (!connector || !(connector instanceof GoogleCalendarConnector)) {
      return c.json({ ok: false, error: 'Calendar not connected' }, 401);
    }

    try {
      const calConfig = deps.config.sources.google_calendar;
      const boundary = calConfig?.boundary ?? {};
      const limit = parseInt(c.req.query('limit') ?? '20', 10);
      const rows = await connector.fetch(boundary, { limit });

      const events = rows.map((row) => {
        const d = row.data as Record<string, unknown>;
        return {
          id: row.source_item_id,
          title: d.title || '',
          start: d.start || '',
          end: d.end || '',
          location: d.location || '',
          body: d.body || '',
          url: d.url || '',
          isAllDay: d.isAllDay || false,
        };
      });

      return c.json({ ok: true, events });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      return c.json({ ok: false, error: message }, 500);
    }
  });

  // Preview calendar events with filters applied
  app.get('/api/calendar/preview', async (c) => {
    const connector = deps.connectorRegistry.get('google_calendar');
    if (!connector || !(connector instanceof GoogleCalendarConnector)) {
      return c.json({ ok: false, error: 'Calendar not connected' }, 401);
    }

    try {
      const calConfig = deps.config.sources.google_calendar;
      const boundary = calConfig?.boundary ?? {};
      const limit = parseInt(c.req.query('limit') ?? '20', 10);
      const rows = await connector.fetch(boundary, { limit });

      const filters = await deps.store.getEnabledFiltersBySource('google_calendar') as QuickFilter[];
      const filtered = applyFilters(rows, filters);

      const mapRow = (row: import('../connectors/types.js').DataRow) => {
        const d = row.data as Record<string, unknown>;
        return {
          id: row.source_item_id,
          title: d.title || '',
          start: d.start || '',
          end: d.end || '',
          location: d.location || '',
          body: d.body || '',
          url: d.url || '',
          isAllDay: d.isAllDay || false,
        };
      };

      return c.json({
        ok: true,
        events: filtered.map(mapRow),
        totalFetched: rows.length,
        afterFilters: filtered.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      return c.json({ ok: false, error: message }, 500);
    }
  });

  // Fetch real emails from connected Gmail account
  app.get('/api/gmail/emails', async (c) => {
    const connector = deps.connectorRegistry.get('gmail');
    if (!connector || !(connector instanceof GmailConnector)) {
      return c.json({ ok: false, error: 'Gmail not connected' }, 401);
    }

    try {
      const gmailConfig = deps.config.sources.gmail;
      const boundary = gmailConfig?.boundary ?? {};
      const limit = parseInt(c.req.query('limit') ?? '20', 10);
      const rows = await connector.fetch(boundary, { limit });

      // Map DataRow format to the shape the frontend expects
      const emails = rows.map((row) => {
        const d = row.data as Record<string, unknown>;
        const attachments = d.attachments as Array<{ name: string }> | undefined;
        return {
          id: row.source_item_id,
          from: d.author_email || d.author_name || '',
          to: Array.isArray(d.participants)
            ? (d.participants as Array<{ email: string; role: string }>)
                .filter((p) => p.role === 'to')
                .map((p) => p.email)
                .join(', ')
            : '',
          subject: d.title || '',
          snippet: (d.snippet as string) || '',
          body: d.body || '',
          date: row.timestamp,
          labels: Array.isArray(d.labels) ? d.labels : [],
          hasAttachment: Array.isArray(attachments) && attachments.length > 0,
        };
      });

      return c.json({ ok: true, emails });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      return c.json({ ok: false, error: message }, 500);
    }
  });

  // Preview emails with filters applied (for GUI preview)
  app.get('/api/gmail/preview', async (c) => {
    const connector = deps.connectorRegistry.get('gmail');
    if (!connector || !(connector instanceof GmailConnector)) {
      return c.json({ ok: false, error: 'Gmail not connected' }, 401);
    }

    try {
      const gmailConfig = deps.config.sources.gmail;
      const boundary = gmailConfig?.boundary ?? {};
      const limit = parseInt(c.req.query('limit') ?? '20', 10);
      const rows = await connector.fetch(boundary, { limit });

      // Load enabled filters and apply
      const filters = await deps.store.getEnabledFiltersBySource('gmail') as QuickFilter[];
      const filtered = applyFilters(rows, filters);

      // Map DataRow format to the shape the frontend expects
      const mapRow = (row: import('../connectors/types.js').DataRow) => {
        const d = row.data as Record<string, unknown>;
        const attachments = d.attachments as Array<{ name: string }> | undefined;
        return {
          id: row.source_item_id,
          from: d.author_email || d.author_name || '',
          to: Array.isArray(d.participants)
            ? (d.participants as Array<{ email: string; role: string }>)
                .filter((p) => p.role === 'to')
                .map((p) => p.email)
                .join(', ')
            : '',
          subject: d.title || '',
          snippet: (d.snippet as string) || '',
          body: d.body || '',
          date: row.timestamp,
          labels: Array.isArray(d.labels) ? d.labels : [],
          hasAttachment: Array.isArray(attachments) && attachments.length > 0,
        };
      };

      return c.json({
        ok: true,
        emails: filtered.map(mapRow),
        totalFetched: rows.length,
        afterFilters: filtered.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      return c.json({ ok: false, error: message }, 500);
    }
  });

  return app;
}

function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

import { getIndexHtml } from './frontend.generated.js';
