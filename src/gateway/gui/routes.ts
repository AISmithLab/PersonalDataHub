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

function getIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="en" class="light">
<head>
  <script>
    window.onerror = function(message, source, lineno, colno, error) {
      fetch('/api/error-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message,
          source: source,
          lineno: lineno,
          colno: colno,
          stack: error ? error.stack : ''
        })
      }).catch(function() {});
      return false;
    };
    window.addEventListener('unhandledrejection', function(event) {
      fetch('/api/error-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Unhandled Promise Rejection: ' + event.reason,
          stack: event.reason ? event.reason.stack : ''
        })
      }).catch(function() {});
    });
  </script>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>PersonalDataHub</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
  <script id="tailwind-config">
    if (typeof tailwind !== 'undefined') {
      tailwind.config = {
        darkMode: "class",
      theme: {
        extend: {
          colors: {
            "on-tertiary-fixed-variant": "#3f484f",
            "primary-fixed": "#80f7dc",
            "on-tertiary": "#ffffff",
            "inverse-surface": "#2d3135",
            "secondary-container": "#e0e3e5",
            "primary-container": "#14a38b",
            "on-background": "#181c20",
            "error": "#ba1a1a",
            "surface-tint": "#006b5a",
            "on-primary-fixed": "#00201a",
            "on-primary-container": "#003028",
            "on-error-container": "#93000a",
            "on-secondary-fixed-variant": "#444749",
            "tertiary-fixed-dim": "#bfc8d0",
            "on-secondary": "#ffffff",
            "secondary-fixed-dim": "#c4c7c9",
            "on-surface": "#181c20",
            "tertiary-container": "#89929a",
            "on-tertiary-fixed": "#141d23",
            "inverse-on-surface": "#eef1f6",
            "inverse-primary": "#62dac0",
            "surface-variant": "#e0e3e8",
            "on-error": "#ffffff",
            "on-secondary-container": "#626567",
            "tertiary-fixed": "#dbe4ed",
            "primary": "#006b5a",
            "outline-variant": "#bccac4",
            "secondary": "#5c5f61",
            "on-tertiary-container": "#222b32",
            "background": "#f7f9ff",
            "surface-bright": "#f7f9ff",
            "surface-container-high": "#e5e8ee",
            "outline": "#6d7a75",
            "surface-container-lowest": "#ffffff",
            "surface-dim": "#d7dadf",
            "on-secondary-fixed": "#191c1e",
            "surface-container-highest": "#e0e3e8",
            "error-container": "#ffdad6",
            "tertiary": "#575f67",
            "on-primary-fixed-variant": "#005144",
            "primary-fixed-dim": "#62dac0",
            "surface-container": "#ebeef3",
            "on-primary": "#ffffff",
            "secondary-fixed": "#e0e3e5",
            "surface-container-low": "#f1f4f9",
            "surface": "#f7f9ff",
            "on-surface-variant": "#3d4945"
          },
          borderRadius: {
            "DEFAULT": "0.25rem",
            "lg": "0.5rem",
            "xl": "0.75rem",
            "full": "9999px"
          },
          spacing: {
            "gutter": "12px",
            "base": "4px",
            "sm": "12px",
            "md": "16px",
            "xs": "8px",
            "xl": "32px",
            "margin": "16px",
            "lg": "24px"
          },
          fontFamily: {
            "mono-label": ["JetBrains Mono"],
            "label-sm": ["Hanken Grotesk"],
            "headline-lg": ["Hanken Grotesk"],
            "headline-md": ["Hanken Grotesk"],
            "label-caps": ["Hanken Grotesk"],
            "body-sm": ["Hanken Grotesk"],
            "body-md": ["Hanken Grotesk"]
          },
          fontSize: {
            "mono-label": ["11px", {"lineHeight": "1", "fontWeight": "500"}],
            "label-sm": ["12px", {"lineHeight": "1.2", "fontWeight": "500"}],
            "headline-lg": ["32px", {"lineHeight": "1.2", "letterSpacing": "-0.02em", "fontWeight": "700"}],
            "headline-md": ["20px", {"lineHeight": "1.4", "fontWeight": "600"}],
            "label-caps": ["12px", {"lineHeight": "1.2", "letterSpacing": "0.05em", "fontWeight": "700"}],
            "body-sm": ["14px", {"lineHeight": "1.5", "fontWeight": "400"}],
            "body-md": ["16px", {"lineHeight": "1.5", "fontWeight": "400"}]
          }
        }
      }
    };
    }
  </script>
  <style>
    :root {
      --primary: #006b5a;
      --primary-hover: #005144;
      --bg: #f7f9ff;
      --card: #ffffff;
      --card-bg: #ffffff;
      --input-bg: #ffffff;
      --sidebar-bg: #f1f4f9;
      --sidebar-border: #bccac4;
      --fg: #181c20;
      --muted: #5c5f61;
      --destructive: #ba1a1a;
      --destructive-hover: #93000a;
      --warning: #f59e0b;
      --success: #006b5a;
      --border: #bccac4;
      --input-border: #bccac4;
      --ring: #006b5a;
      --radius: 12px;
      --sidebar-width: 240px;
    }
    .material-symbols-outlined {
      font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
      user-select: none;
      display: inline-block;
      line-height: 1;
      text-transform: none;
      letter-spacing: normal;
      word-wrap: normal;
      white-space: nowrap;
      direction: ltr;
    }
    body {
      font-family: 'Hanken Grotesk', sans-serif;
      -webkit-tap-highlight-color: transparent;
      background-color: var(--bg);
      color: var(--fg);
      padding-top: env(safe-area-inset-top, 0px);
    }
    @media (max-width: 768px) {
      #bottom-nav {
        padding-bottom: env(safe-area-inset-bottom, 0px);
      }
    }
    .logic-card-shadow {
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .hide-scrollbar::-webkit-scrollbar {
      display: none;
    }
    .hide-scrollbar {
      -ms-overflow-style: none;
      scrollbar-width: none;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner {
      border: 2px solid var(--border);
      border-top-color: var(--primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    .nav-item.active {
      background-color: var(--sidebar-bg);
      color: var(--primary) !important;
      border-left-color: var(--primary);
      font-weight: 600;
    }
    .nav-item.active .material-symbols-outlined {
      font-variation-settings: 'FILL' 1;
    }
    #bottom-nav a.active {
      color: var(--primary) !important;
      font-weight: 600;
    }
    #bottom-nav a.active .material-symbols-outlined {
      font-variation-settings: 'FILL' 1;
    }
    .chat-bubble-user {
      border-bottom-right-radius: 4px;
    }
    .chat-bubble-ai {
      border-bottom-left-radius: 4px;
    }
    .status-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .status-dot-connected {
      background: var(--success);
      box-shadow: 0 0 6px rgba(0,107,90,0.5);
    }
    .status-dot-disconnected {
      background: #c4c7c9;
    }
    .status-dot-pending {
      background: var(--warning);
      box-shadow: 0 0 6px rgba(245,158,11,0.5);
    }
    /* Fallback styles for inline elements of non-redesigned tabs */
    .card { background: var(--card); border-radius: var(--radius); padding: 20px; margin-bottom: 16px; border: 1px solid var(--border); box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    .card h2 { font-size: 16px; font-weight: 600; margin-bottom: 12px; color: var(--fg); }
    .card h3 { font-size: 15px; font-weight: 600; margin-bottom: 8px; color: var(--muted); }
    .status { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; }
    .status.connected { background: rgba(0,107,90,0.1); color: var(--success); }
    .status.disconnected { background: rgba(239,68,68,0.08); color: var(--destructive); }
    .status.pending { background: rgba(245,158,11,0.1); color: #b45309; }
    .status.approved { background: rgba(0,107,90,0.1); color: var(--success); }
    .status.rejected { background: rgba(239,68,68,0.08); color: var(--destructive); }
    .status.committed { background: rgba(0,107,90,0.1); color: var(--success); }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 18px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500; font-family: inherit; transition: all 0.15s; line-height: 1; }
    .btn-primary { background: var(--primary); color: #fff; }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-outline { background: var(--card); color: var(--fg); border: 1px solid var(--border); }
    .btn-outline:hover { background: #f1f4f9; }
    .btn-sm { padding: 6px 12px; font-size: 13px; }
    .btn-ghost { background: transparent; color: var(--muted); border: none; }
    .btn-ghost:hover { background: rgba(0,0,0,0.04); color: var(--fg); }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 14px; }
    th { font-weight: 600; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    input[type="text"], input[type="number"], select { padding: 9px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px; font-family: inherit; width: 100%; outline: none; transition: border-color 0.15s; background: var(--card); color: var(--fg); }
    input[type="text"]:focus, input[type="number"]:focus, select:focus { border-color: var(--primary); }
    .form-group { margin-bottom: 14px; }
    .form-group label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 5px; color: var(--muted); }
    .actions { display: flex; gap: 8px; margin-top: 14px; }
    .empty { text-align: center; color: var(--muted); padding: 24px; font-size: 14px; }
    .ac-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .ac-row label { font-size: 14px; white-space: nowrap; }
    .ac-row input[type="datetime-local"] { width: auto; flex: 1; max-width: 220px; }
    .ac-row input[type="text"] { flex: 1; }
    .checkbox-group { display: flex; flex-wrap: wrap; gap: 2px 14px; }
    .checkbox-group .toggle { margin: 2px 0; position: relative; }
    .filter-panel { margin-left: 26px; margin-bottom: 10px; border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; display: none; }
    .filter-panel.show { display: block; }
    .filter-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .filter-row:last-child { margin-bottom: 0; }
    .filter-label { font-size: 14px; color: var(--fg); min-width: 110px; }
    .filter-row input[type="text"] { flex: 1; }
    .filter-row input[type="date"] { flex: 1; }
    .filter-row select { border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; background: var(--card); font-size: 14px; }
    .filter-row input[type="number"] { width: 100px; }
    .expand-link { font-size: 13px; color: var(--primary); cursor: pointer; text-decoration: none; }
    .sel-links { font-size: 12px; }
    .sel-links a { color: var(--primary); text-decoration: none; cursor: pointer; }
    .repo-item { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; }
    .repo-header { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; background: var(--sidebar-bg); }
    .repo-name { font-family: 'JetBrains Mono', monospace; font-size: 14px; flex: 1; }
    .repo-chevron { font-size: 13px; color: var(--muted); }
    .repo-perms { padding: 12px 14px 4px; border-top: 1px solid var(--border); display: none; }
    .repo-perms.show { display: block; }
    .perm-grid { display: flex; gap: 24px; }
    .perm-col h4 { font-size: 13px; font-weight: 700; color: var(--fg); margin-bottom: 6px; }
    .email-card { border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 14px; overflow: hidden; background: var(--card); }
    .email-card-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); }
    .email-card-title { font-size: 15px; font-weight: 600; color: var(--fg); }
    .email-card-meta { padding: 12px 18px 0; }
    .email-field { display: flex; align-items: baseline; gap: 8px; padding: 4px 0; font-size: 14px; }
    .email-field-label { font-weight: 600; color: var(--muted); min-width: 55px; font-size: 12px; text-transform: uppercase; }
    .email-card-body { padding: 10px 18px 14px; }
    .email-body-display { white-space: pre-wrap; word-wrap: break-word; font-family: 'JetBrains Mono', monospace; font-size: 13px; line-height: 1.7; margin: 0; background: #f1f4f9; border-radius: 8px; padding: 14px 16px; color: var(--fg); }
    .email-card-actions { display: flex; gap: 8px; padding: 0 18px 14px; justify-content: flex-end; }
    .resolved-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; font-size: 14px; border-bottom: 1px solid var(--border); }
    .gmail-grid { display: grid; grid-template-columns: 1fr 400px; gap: 24px; }
    .summary-bar { display: flex; align-items: center; gap: 20px; padding: 10px 16px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 16px; }
    .summary-stat { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .summary-stat-value { font-size: 18px; font-weight: 700; font-family: 'JetBrains Mono', monospace; color: var(--fg); }
    .summary-stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; }
    .summary-divider { width: 1px; height: 28px; background: var(--border); }
    .field-pill { display: inline-block; font-size: 13px; padding: 4px 12px; border-radius: 9999px; border: 1px solid; cursor: pointer; background: none; }
    .field-pill-on { border-color: rgba(0,107,90,0.4); background: rgba(0,107,90,0.08); color: var(--primary); }
    .field-pill-off { border-color: var(--border); color: var(--muted); text-decoration: line-through; opacity: 0.5; }
    .email-list-header { display: flex; align-items: center; gap: 12px; padding: 12px 20px; background: var(--sidebar-bg); border-bottom: 1px solid var(--border); }
    .email-row { border-bottom: 1px solid var(--border); }
    .email-row-btn { display: block; width: 100%; text-align: left; padding: 14px 20px; background: none; border: none; cursor: pointer; }
    .email-row-btn:hover { background: rgba(0,107,90,0.03); }
    .email-row-sender { font-size: 14px; font-weight: 600; color: var(--fg); }
  </style>
</head>
<body class="font-body-md text-body-md bg-background text-on-background min-h-screen">
  <!-- Login screen -->
  <div id="login-screen" style="display:none" class="fixed inset-0 z-50 flex items-center justify-center bg-background p-4">
    <div class="bg-surface border border-outline-variant rounded-2xl p-8 max-w-sm w-full shadow-lg flex flex-col gap-6">
      <div class="text-center flex flex-col items-center gap-2">
        <span class="material-symbols-outlined text-primary text-4xl">account_tree</span>
        <h1 class="font-headline-lg text-headline-lg text-on-background font-bold tracking-tight">PersonalDataHub</h1>
        <p id="login-subtitle" class="font-body-sm text-body-sm text-on-surface-variant">Sign in to continue</p>
      </div>
      <form id="login-form" class="flex flex-col gap-4" onsubmit="return handleAuthSubmit(event)">
        <input id="auth-email" type="email" placeholder="Email" required class="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors">
        <input id="auth-password" type="password" placeholder="Password" required minlength="8" class="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors">
        <button id="auth-submit" type="submit" class="w-full bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps py-2.5 rounded-xl transition-all active:scale-95">Sign In</button>
      </form>
      <div id="login-error" class="text-error text-body-sm text-center"></div>
      <div class="text-center font-body-sm text-body-sm text-on-surface-variant">
        <a id="auth-toggle" href="#" onclick="toggleAuthMode();return false;" class="text-primary hover:underline font-medium">New here? Create account</a>
      </div>
    </div>
  </div>

  <div id="app" style="display:none" class="min-h-screen flex bg-background text-on-background">
    <!-- Desktop Sidebar -->
    <aside class="hidden md:flex md:flex-col md:w-60 md:fixed md:inset-y-0 md:left-0 md:z-40 bg-surface border-r border-outline-variant shrink-0">
      <div class="p-md border-b border-outline-variant flex flex-col gap-base">
        <div class="flex items-center gap-xs">
          <span class="material-symbols-outlined text-primary text-2xl">account_tree</span>
          <span class="font-headline-md text-headline-md font-bold text-primary tracking-tight">PersonalDataHub</span>
        </div>
        <span class="font-body-sm text-body-sm text-on-surface-variant leading-none">Access control for AI agents</span>
      </div>
      <nav class="flex-grow py-md overflow-y-auto flex flex-col gap-1">
        <a class="nav-item flex items-center gap-sm px-md py-3 text-body-md font-body-md text-on-surface-variant hover:bg-surface-container-high transition-colors cursor-pointer border-l-4 border-transparent active" data-tab="ai" onclick="switchTab('ai')">
          <span class="material-symbols-outlined">chat</span>
          <span class="flex-grow">Chat</span>
          <span class="w-2.5 h-2.5 rounded-full" id="ai-dot" style="background:var(--muted)"></span>
        </a>
        <a class="nav-item flex items-center gap-sm px-md py-3 text-body-md font-body-md text-on-surface-variant hover:bg-surface-container-high transition-colors cursor-pointer border-l-4 border-transparent" data-tab="skill" onclick="switchTab('skill')">
          <span class="material-symbols-outlined">bolt</span>
          <span class="flex-grow">Skill</span>
        </a>
        <a class="nav-item flex items-center gap-sm px-md py-3 text-body-md font-body-md text-on-surface-variant hover:bg-surface-container-high transition-colors cursor-pointer border-l-4 border-transparent" data-tab="memory" onclick="switchTab('memory')">
          <span class="material-symbols-outlined">database</span>
          <span class="flex-grow">Memory</span>
          <span class="bg-primary text-on-primary font-mono-label text-mono-label px-2 py-0.5 rounded-full" id="memory-count-badge" style="display:none">0</span>
        </a>
        <a class="nav-item flex items-center gap-sm px-md py-3 text-body-md font-body-md text-on-surface-variant hover:bg-surface-container-high transition-colors cursor-pointer border-l-4 border-transparent" data-tab="settings" onclick="switchTab('settings')">
          <span class="material-symbols-outlined">settings</span>
          <span class="flex-grow">Settings</span>
        </a>
      </nav>
      <div class="p-md border-t border-outline-variant flex flex-col gap-sm">
        <span class="sidebar-save-flash text-success font-mono-label text-mono-label opacity-0" id="sidebar-flash">Saved</span>
        <button class="w-full text-center py-2 border border-outline hover:bg-surface-container-high rounded-lg text-body-sm font-body-sm text-on-surface-variant transition-colors" onclick="logout()">Sign out</button>
      </div>
    </aside>

    <!-- Main Content Area -->
    <div class="flex-grow md:pl-60 flex flex-col min-w-0">
      <div class="flex-grow pb-24 md:pb-0" id="content"></div>
    </div>
  </div>

  <!-- Bottom navigation (visible only on mobile) -->
  <nav id="bottom-nav" class="fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-outline-variant flex justify-around items-center py-2 md:hidden">
    <a data-tab="ai" onclick="switchTab('ai')" class="flex flex-col items-center gap-1 px-4 py-1 text-on-surface-variant active:scale-95 transition-all">
      <span class="material-symbols-outlined">chat</span>
      <span class="font-label-sm text-label-sm">Chat</span>
    </a>
    <a data-tab="skill" onclick="switchTab('skill')" class="flex flex-col items-center gap-1 px-4 py-1 text-on-surface-variant active:scale-95 transition-all">
      <span class="material-symbols-outlined">bolt</span>
      <span class="font-label-sm text-label-sm">Skill</span>
    </a>
    <a data-tab="memory" onclick="switchTab('memory')" class="flex flex-col items-center gap-1 px-4 py-1 text-on-surface-variant active:scale-95 transition-all">
      <span class="material-symbols-outlined">database</span>
      <span class="font-label-sm text-label-sm">Memory</span>
    </a>
    <a data-tab="settings" onclick="switchTab('settings')" class="flex flex-col items-center gap-1 px-4 py-1 text-on-surface-variant active:scale-95 transition-all">
      <span class="material-symbols-outlined">settings</span>
      <span class="font-label-sm text-label-sm">Settings</span>
    </a>
  </nav>

  <script>
    var currentTab = 'ai';
    var ALL_FIELDS = ['Subject', 'Body', 'Sender', 'Recipients', 'Labels', 'Attachments', 'Snippet'];
    var DEMO_EMAILS = [
      { id:'e1', from:'alice@company.com', to:'owner@gmail.com', subject:'Q1 Planning Meeting', snippet:'Can we reschedule Thursday\\'s meeting to 2pm?', body:'Hi,\\n\\nCan we reschedule Thursday\\'s meeting to 2pm? I have a conflict with the original time.\\n\\nThanks,\\nAlice', date:'2025-02-22T09:15:00Z', labels:['Inbox'], hasAttachment:false },
      { id:'e2', from:'bob@company.com', to:'owner@gmail.com', subject:'Code Review: PR #142', snippet:'Please review the latest changes to the auth module', body:'Hey,\\n\\nI\\'ve pushed the latest changes to the auth module. Could you take a look at PR #142?\\n\\nThe main changes are:\\n- Added JWT refresh logic\\n- Fixed session expiry bug\\n- Updated tests\\n\\nThanks!', date:'2025-02-22T08:30:00Z', labels:['Inbox'], hasAttachment:false },
      { id:'e3', from:'notifications@github.com', to:'owner@gmail.com', subject:'[PersonalDataHub] Issue #23: Add rate limiting', snippet:'New issue opened by contributor', body:'A new issue has been opened in owner/PersonalDataHub:\\n\\nTitle: Add rate limiting to API endpoints\\nOpened by: @contributor\\n\\nWe should add rate limiting to prevent abuse of the API endpoints.', date:'2025-02-22T07:45:00Z', labels:['Inbox','GitHub'], hasAttachment:false },
      { id:'e4', from:'team@company.com', to:'owner@gmail.com', subject:'Weekly Standup Notes - Feb 21', snippet:'Here are this week\\'s standup notes', body:'Team standup notes:\\n\\n- Alice: Finishing Q1 roadmap\\n- Bob: Auth module refactor\\n- Carol: Performance testing\\n- Owner: Access control gateway MVP\\n\\nAction items:\\n1. Schedule Q1 review\\n2. Deploy staging build', date:'2025-02-21T17:00:00Z', labels:['Inbox','Starred'], hasAttachment:false },
      { id:'e5', from:'carol@company.com', to:'owner@gmail.com', subject:'Performance Report Q4', snippet:'Attached is the Q4 performance report with benchmarks', body:'Hi,\\n\\nPlease find attached the Q4 performance report. Key highlights:\\n- API latency reduced by 34%\\n- Uptime: 99.97%\\n- Error rate: 0.02%\\n\\nLet me know if you have questions.', date:'2025-02-21T14:20:00Z', labels:['Inbox'], hasAttachment:true },
      { id:'e6', from:'noreply@stripe.com', to:'owner@gmail.com', subject:'Your January invoice is ready', snippet:'Your invoice for January 2025 is now available', body:'Your invoice for January 2025 is now available.\\n\\nAmount: $49.00\\nPlan: Pro\\nPeriod: Jan 1 - Jan 31, 2025\\n\\nView your invoice at dashboard.stripe.com', date:'2025-02-01T10:00:00Z', labels:['Inbox'], hasAttachment:true },
      { id:'e7', from:'owner@gmail.com', to:'team@company.com', subject:'Project Update - PersonalDataHub', snippet:'Quick update on the access control project', body:'Team,\\n\\nQuick update on PersonalDataHub:\\n- OAuth flow completed\\n- Gmail integration working\\n- GitHub permissions UI done\\n- Next: Action staging & audit log\\n\\nETA for MVP: end of February.', date:'2025-02-20T09:00:00Z', labels:['Sent'], hasAttachment:false },
      { id:'e8', from:'security@google.com', to:'owner@gmail.com', subject:'Security alert: New sign-in', snippet:'We noticed a new sign-in to your Google Account', body:'We noticed a new sign-in to your Google Account.\\n\\nDevice: MacBook Pro\\nLocation: San Francisco, CA\\nTime: Feb 19, 2025 3:45 PM\\n\\nIf this was you, you can disregard this email.', date:'2025-02-19T15:45:00Z', labels:['Inbox'], hasAttachment:false },
      { id:'e9', from:'dave@external.io', to:'owner@gmail.com', subject:'Partnership Proposal', snippet:'Would love to discuss a potential integration', body:'Hi,\\n\\nI\\'m Dave from External.io. We\\'d love to discuss a potential integration between our platform and PersonalDataHub.\\n\\nWould you be available for a 30-min call next week?\\n\\nBest,\\nDave', date:'2025-02-18T11:30:00Z', labels:['Inbox'], hasAttachment:false },
      { id:'e10', from:'hr@company.com', to:'owner@gmail.com', subject:'Benefits Enrollment Reminder', snippet:'Open enrollment closes Feb 28', body:'Reminder: Open enrollment for 2025 benefits closes on February 28.\\n\\nPlease review and update your selections at benefits.company.com.\\n\\nQuestions? Contact HR.', date:'2025-02-15T08:00:00Z', labels:['Inbox'], hasAttachment:true },
      { id:'e11', from:'alice@company.com', to:'owner@gmail.com', subject:'Re: API Design Review', snippet:'Looks good, just a few minor suggestions', body:'Looks good overall! A few suggestions:\\n\\n1. Consider pagination for the list endpoint\\n2. Add rate limiting headers\\n3. Document the error codes\\n\\nOtherwise LGTM.', date:'2025-02-14T16:00:00Z', labels:['Inbox'], hasAttachment:false },
      { id:'e12', from:'newsletter@techweekly.com', to:'owner@gmail.com', subject:'This Week in Tech: AI Privacy Concerns', snippet:'The latest on AI regulation and data privacy', body:'This Week in Tech Newsletter\\n\\n1. EU proposes new AI transparency rules\\n2. Major breach at social media company\\n3. Open source privacy tools gaining traction\\n4. Interview: Building privacy-first AI agents\\n\\nRead more at techweekly.com', date:'2025-02-13T06:00:00Z', labels:['Inbox','Newsletter'], hasAttachment:false },
    ];

    var state = {
      sources: [], filters: [], staging: [], audit: [],
      gmail: {},
      github: { repoList: [], reposLoading: false, reposLoaded: false, filterOwner: '', search: '' },
      expandedRepos: {},
      expandedEmail: null,
      editingAction: null,
      realEmails: null,
      emailsLoading: false,
      emailsError: null,
      realEvents: null,
      eventsLoading: false,
      eventsError: null,
      filterTypes: {},
      sms: { messages: null, loading: false, error: null, box: 'inbox', contextMenu: null, autoReplying: false },
      chat: { messages: [], loading: false, error: null, aiAvailable: false, stagedSmsIds: [], codeBlocks: {}, configuredModel: '' },
      memories: { items: [], loading: false, loaded: false, editingId: null, editContent: '', adding: false, newContent: '', error: null },
      skills: { items: [], loading: false, loaded: false, editingId: null, editContent: { name: '', instructions: '', trigger_event: 'sms_received', current_view: 'SUMMARIZED', logic_tree: [] }, adding: false, newName: '', newInstructions: '', newTrigger: 'sms_received', newCurrentView: 'SUMMARIZED', newLogicTree: [], error: null, isTranslating: {} },
      settingsProvider: 'anthropic',
      autoReply: { enabled: false, maxToolRounds: 3, loading: false, testResult: null, testLoading: false },
      settingsSection: 'ai',
    };
    var _saveTimer = null;

    // Sidebar + bottom-nav switching
    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.nav-item[data-tab], #bottom-nav a[data-tab]').forEach(function(el) {
        el.classList.toggle('active', el.dataset.tab === tab);
      });
      render();
    }
    window.switchTab = switchTab;

    function injectDemoQuestion(text) {
      var input = document.getElementById('chat-input');
      if (input) {
        input.value = text;
        sendChatMessage();
      }
    }
    window.injectDemoQuestion = injectDemoQuestion;

    async function fetchData() {
      try {
        var resList = await Promise.all([
          fetch('/api/sources').then(function(r) { return r.json(); }),
          fetch('/api/filters').then(function(r) { return r.json(); }),
          fetch('/api/staging').then(function(r) { return r.json(); }),
          fetch('/api/audit?limit=20').then(function(r) { return r.json(); })
        ]);
        var sources = resList[0];
        var filtersData = resList[1];
        var staging = resList[2];
        var audit = resList[3];

        state.sources = sources.sources || [];
        state.filters = filtersData.filters || [];
        state.filterTypes = filtersData.filterTypes || {};
        state.staging = staging.actions || [];
        state.audit = audit.entries || [];
      } catch (err) {
        console.warn('[fetchData] Failed to fetch backend data:', err);
      }

      // Fetch real emails if Gmail is connected (uses preview with filters)
      var gm = state.sources.find(function(s) { return s.name === 'gmail'; });
      if (gm && gm.connected && !state.realEmails && !state.emailsLoading) {
        state.emailsLoading = true;
        state.emailsError = null;
        fetch('/api/gmail/preview?limit=20&t=' + Date.now())
          .then(function(r) { return r.json(); })
          .then(function(data) {
            state.emailsLoading = false;
            state.realEmails = data.messages || [];
            if (currentTab === 'gmail') render();
          })
          .catch(function(err) {
            state.emailsLoading = false;
            state.emailsError = err.message || 'Network error';
            if (currentTab === 'gmail') render();
          });
      }

      // Fetch real calendar events if Google Calendar is connected
      var cal = state.sources.find(function(s) { return s.name === 'google_calendar'; });
      if (cal && cal.connected && !state.realEvents && !state.eventsLoading) {
        state.eventsLoading = true;
        state.eventsError = null;
        fetch('/api/google_calendar/preview?limit=20&t=' + Date.now())
          .then(function(r) { return r.json(); })
          .then(function(data) {
            state.eventsLoading = false;
            state.realEvents = data.events || [];
            if (currentTab === 'google_calendar') render();
          })
          .catch(function(err) {
            state.eventsLoading = false;
            state.eventsError = err.message || 'Network error';
            if (currentTab === 'google_calendar') render();
          });
      }
      // Check AI configuration status
      fetch('/api/chat/status').then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) {
          state.chat.aiAvailable = d.configured;
          if (d.provider) state.settingsProvider = d.provider;
          if (d.model) state.chat.configuredModel = d.model;
          if (currentTab === 'ai' || currentTab === 'settings') render();
        }
      }).catch(function() { /* non-fatal */ });

      // Check auto-reply status
      fetch('/api/settings/auto-reply').then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) {
          state.autoReply.enabled = d.enabled;
          if (typeof d.maxToolRounds === 'number') state.autoReply.maxToolRounds = d.maxToolRounds;
          if (currentTab === 'settings') render();
        }
      }).catch(function() { /* non-fatal */ });

      // Load skills
      fetch('/api/skills').then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) {
          state.skills.items = d.skills;
          state.skills.loaded = true;
          if (currentTab === 'skill') render();
        }
      }).catch(function() { /* non-fatal */ });

      render();
    }

    function loadSkills(force) {
      if (!force && state.skills.loaded) return;
      if (state.skills.loading) return;
      state.skills.loading = true;
      fetch('/api/skills').then(function(r) { return r.json(); }).then(function(d) {
        state.skills.loading = false;
        if (d.ok) { state.skills.items = d.skills; state.skills.loaded = true; if (currentTab === 'skill') render(); }
      }).catch(function() { state.skills.loading = false; });
    }
    window.loadSkills = loadSkills;

    function loadMemories(force) {
      if (!force && state.memories.loaded) return;
      if (state.memories.loading) return;
      state.memories.loading = true;
      fetch('/api/memories').then(function(r) { return r.json(); }).then(function(d) {
        state.memories.loading = false;
        if (d.ok) {
          state.memories.items = d.memories;
          state.memories.loaded = true;
          if (currentTab === 'memory') render();
          else {
            var el = document.getElementById('mem-count-display');
            if (el) el.textContent = d.memories.length + ' memories saved';
          }
        }
      }).catch(function() { state.memories.loading = false; });
    }
    window.loadMemories = loadMemories;

    function deleteMemory(id) {
      fetch('/api/memories/' + encodeURIComponent(id), { method: 'DELETE' }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) { state.memories.items = state.memories.items.filter(function(m) { return m.id !== id; }); render(); }
      }).catch(function() {});
    }
    window.deleteMemory = deleteMemory;

    function startEditMemory(id) {
      var m = state.memories.items.find(function(x) { return x.id === id; });
      if (!m) return;
      state.memories.editingId = id;
      state.memories.editContent = m.content;
      render();
    }
    window.startEditMemory = startEditMemory;

    function cancelEditMemory() {
      state.memories.editingId = null;
      state.memories.editContent = '';
      render();
    }
    window.cancelEditMemory = cancelEditMemory;

    function saveEditMemory(id) {
      var content = state.memories.editContent.trim();
      if (!content) return;
      fetch('/api/memories/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content }),
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) {
          state.memories.items = state.memories.items.map(function(m) {
            return m.id === id ? Object.assign({}, m, { content: content }) : m;
          });
          state.memories.editingId = null;
          state.memories.editContent = '';
          render();
        }
      }).catch(function() {});
    }
    window.saveEditMemory = saveEditMemory;

    function updateMemoryEditContent(val) {
      state.memories.editContent = val;
    }
    window.updateMemoryEditContent = updateMemoryEditContent;

    function toggleAddMemory() {
      state.memories.adding = !state.memories.adding;
      state.memories.newContent = '';
      state.memories.error = null;
      render();
    }
    window.toggleAddMemory = toggleAddMemory;

    function updateNewMemoryContent(val) {
      state.memories.newContent = val;
    }
    window.updateNewMemoryContent = updateNewMemoryContent;

    function submitNewMemory() {
      var content = state.memories.newContent.trim();
      if (!content) return;
      fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content }),
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) {
          loadMemories(true);
          state.memories.adding = false;
          state.memories.newContent = '';
          state.memories.error = null;
        } else {
          state.memories.error = d.error || 'Failed to save';
          render();
        }
      }).catch(function() { state.memories.error = 'Network error'; render(); });
    }
    window.submitNewMemory = submitNewMemory;

    function render() {
      var focused = document.activeElement;
      var focusId = focused && focused.id ? focused.id : null;
      var cursorPos = focused && focused.selectionStart != null ? focused.selectionStart : null;

      // Sync active navigation classes
      document.querySelectorAll('.nav-item[data-tab], #bottom-nav a[data-tab]').forEach(function(el) {
        el.classList.toggle('active', el.dataset.tab === currentTab);
      });

      var content = document.getElementById('content');
      if (!content) return;
      switch (currentTab) {
        case 'overview': content.innerHTML = renderOverviewTab(); break;
        case 'gmail': content.innerHTML = renderGmailTab(); break;
        case 'github': content.innerHTML = renderGitHubTab(); break;
        case 'google_calendar': content.innerHTML = renderCalendarTab(); break;
        case 'sms': content.innerHTML = renderSmsTab(); loadSmsMessages(); break;
        case 'ai': content.innerHTML = renderAiTab(); var _cm = document.getElementById('chat-messages'); if (_cm) _cm.scrollTop = _cm.scrollHeight; break;
        case 'skill': content.innerHTML = renderSkillTab(); loadSkills(); break;
        case 'memory': content.innerHTML = renderMemoryTab(); loadMemories(); break;
        case 'settings': content.innerHTML = renderSettingsTab(); loadMemories(); break;
      }
      // Update sidebar badges and status dots
      var gmailPendingCount = state.staging.filter(function(a) { return a.source === 'gmail' && a.status === 'pending'; }).length;
      var gmailBadge = document.getElementById('gmail-badge');
      if (gmailBadge) {
        if (gmailPendingCount) { gmailBadge.textContent = gmailPendingCount; gmailBadge.style.display = ''; }
        else { gmailBadge.style.display = 'none'; }
      }
      var bnGmailBadge = document.getElementById('bn-gmail-badge');
      if (bnGmailBadge) {
        if (gmailPendingCount) { bnGmailBadge.textContent = gmailPendingCount; bnGmailBadge.style.display = ''; }
        else { bnGmailBadge.style.display = 'none'; }
      }
      var calPendingCount = state.staging.filter(function(a) { return a.source === 'google_calendar' && a.status === 'pending'; }).length;
      var calBadge = document.getElementById('calendar-badge');
      if (calBadge) {
        if (calPendingCount) { calBadge.textContent = calPendingCount; calBadge.style.display = ''; }
        else { calBadge.style.display = 'none'; }
      }
      var bnCalBadge = document.getElementById('bn-cal-badge');
      if (bnCalBadge) {
        if (calPendingCount) { bnCalBadge.textContent = calPendingCount; bnCalBadge.style.display = ''; }
        else { bnCalBadge.style.display = 'none'; }
      }
      // Gmail status dot
      var gmailSource = state.sources.find(function(s) { return s.name === 'gmail'; });
      var gmailDot = document.getElementById('gmail-dot');
      if (gmailDot) {
        gmailDot.className = 'status-dot ' + (gmailSource && gmailSource.connected ? 'status-dot-connected' : 'status-dot-disconnected');
      }
      // Calendar status dot
      var calSource = state.sources.find(function(s) { return s.name === 'google_calendar'; });
      var calDot = document.getElementById('calendar-dot');
      if (calDot) {
        calDot.className = 'status-dot ' + (calSource && calSource.connected ? 'status-dot-connected' : 'status-dot-disconnected');
      }
      // GitHub status dot
      var ghSource = state.sources.find(function(s) { return s.name === 'github'; });
      var ghDot = document.getElementById('github-dot');
      if (ghDot) {
        ghDot.className = 'status-dot ' + (ghSource && ghSource.connected ? 'status-dot-connected' : 'status-dot-disconnected');
      }
      // AI status dot
      var aiDot = document.getElementById('ai-dot');
      if (aiDot) {
        aiDot.style.background = state.chat.aiAvailable ? 'var(--success)' : 'var(--muted)';
      }
      // Memory count badge
      var memBadge = document.getElementById('memory-count-badge');
      if (memBadge) {
        var mc = state.memories.items.length;
        if (mc) { memBadge.textContent = mc; memBadge.style.display = ''; }
        else { memBadge.style.display = 'none'; }
      }

      if (focusId) {
        var el = document.getElementById(focusId);
        if (el) { el.focus(); if (cursorPos != null && el.setSelectionRange) el.setSelectionRange(cursorPos, cursorPos); }
      }
    }

    function chk(v) { return v ? 'checked' : ''; }

    function renderOverviewTab() {
      var gmail = state.sources.find(function(s) { return s.name === 'gmail'; });
      var github = state.sources.find(function(s) { return s.name === 'github'; });
      var cal = state.sources.find(function(s) { return s.name === 'google_calendar'; });
      var gmailConnected = gmail && gmail.connected;
      var ghConnected = github && github.connected;
      var calConnected = cal && cal.connected;
      var gmailAccount = gmail && gmail.accountInfo;
      var ghAccount = github && github.accountInfo;
      var calAccount = cal && cal.accountInfo;
      var gmailFilters = (state.filters || []).filter(function(f) { return f.source === 'gmail'; });
      var activeFilterCount = gmailFilters.filter(function(f) { return f.enabled; }).length;
      var calFilters = (state.filters || []).filter(function(f) { return f.source === 'google_calendar'; });
      var activeCalFilterCount = calFilters.filter(function(f) { return f.enabled; }).length;
      var enabledRepos = (state.github.repoList || []).filter(function(r) { return r.enabled; }).length;
      var totalRepos = (state.github.repoList || []).length;
      var pendingCount = state.staging.filter(function(a) { return a.status === 'pending'; }).length;

      var recentHtml = '';
      if (state.audit.length) {
        recentHtml = state.audit.slice(0, 5).map(function(e) {
          var d = typeof e.details === 'string' ? JSON.parse(e.details) : e.details;
          var evClass = '';
          if (e.event.indexOf('approved') !== -1 || e.event.indexOf('committed') !== -1) evClass = 'connected';
          else if (e.event.indexOf('rejected') !== -1) evClass = 'rejected';
          else if (e.event.indexOf('proposed') !== -1) evClass = 'pending';
          var time = new Date(e.timestamp);
          var timeStr = time.getHours().toString().padStart(2,'0') + ':' + time.getMinutes().toString().padStart(2,'0');
          var respLine = d.responseSummary ? '<div style="padding:2px 0 4px 52px;border-bottom:1px solid var(--border)"><details style="font-size:12px;color:var(--muted);cursor:pointer"><summary style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><em>Response:</em> ' + formatResponsePreview(d.responseSummary) + '</summary>' + formatResponseDetails(d.responseSummary) + '</details></div>' : '';
          return '<div style="display:flex;align-items:center;gap:12px;padding:8px 0;' + (respLine ? '' : 'border-bottom:1px solid var(--border);') + 'font-size:14px">' +
            '<span class="font-mono" style="font-size:14px;color:var(--muted);min-width:40px">' + timeStr + '</span>' +
            '<span class="status ' + evClass + '" style="font-size:14px">' + e.event + '</span>' +
            '<span style="flex:1;color:var(--muted);font-size:14px;overflow-wrap:break-word;word-break:break-word">' + (d.purpose || d.result || (e.source || '')) + '</span>' +
            '</div>' + respLine;
        }).join('');
      } else {
        recentHtml = '<p class="empty">No recent activity.</p>';
      }

      return \`
        <div style="margin-bottom:24px">
          <h1 style="font-size:24px;font-weight:700;letter-spacing:-0.5px;color:var(--fg)">Access Control Gateway</h1>
          <p style="font-size:14px;color:var(--muted);margin-top:4px">Zero access by default. Control exactly what AI agents can see.</p>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px">
          <div class="card source-tile" style="cursor:pointer" onclick="switchTab('sms')">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:8px">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.4 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16.92z"/></svg>
                <span style="font-weight:600;font-size:15px">SMS</span>
              </div>
              <span class="status-dot status-dot-connected"></span>
            </div>
            <p style="font-size:14px;color:var(--muted);margin-bottom:8px">Messages via Android bridge</p>
            <div style="display:flex;align-items:center;gap:4px;font-size:14px;color:var(--primary);font-weight:500">Open <span style="font-size:14px">&rarr;</span></div>
          </div>

          <div class="card source-tile" style="cursor:pointer" onclick="switchTab('gmail')">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:8px">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <span style="font-weight:600;font-size:15px">Email</span>
              </div>
              <span class="status-dot \${gmailConnected ? 'status-dot-connected' : 'status-dot-disconnected'}"></span>
            </div>
            \${gmailConnected && gmailAccount && gmailAccount.email ? '<p style="font-size:14px;color:var(--muted);margin-bottom:8px">' + gmailAccount.email + '</p>' : '<p style="font-size:14px;color:var(--muted);margin-bottom:8px">Not connected</p>'}
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-size:13px;color:var(--muted)">Filters: <strong class="font-mono" style="color:var(--fg)">\${activeFilterCount} active</strong></span>
              \${pendingCount ? '<span class="nav-badge">' + pendingCount + ' pending</span>' : ''}
            </div>
            <div style="margin-top:10px;display:flex;align-items:center;gap:4px;font-size:14px;color:var(--primary);font-weight:500">Configure <span style="font-size:14px">&rarr;</span></div>
          </div>

          <div class="card source-tile" style="cursor:pointer" onclick="switchTab('google_calendar')">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:8px">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span style="font-weight:600;font-size:15px">Calendar</span>
              </div>
              <span class="status-dot \${calConnected ? 'status-dot-connected' : 'status-dot-disconnected'}"></span>
            </div>
            \${calConnected && calAccount && calAccount.email ? '<p style="font-size:14px;color:var(--muted);margin-bottom:8px">' + calAccount.email + '</p>' : '<p style="font-size:14px;color:var(--muted);margin-bottom:8px">Not connected</p>'}
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-size:13px;color:var(--muted)">Filters: <strong class="font-mono" style="color:var(--fg)">\${activeCalFilterCount} active</strong></span>
            </div>
            <div style="margin-top:10px;display:flex;align-items:center;gap:4px;font-size:14px;color:var(--primary);font-weight:500">Configure <span style="font-size:14px">&rarr;</span></div>
          </div>

          <div class="card source-tile" style="cursor:pointer" onclick="switchTab('github')">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:8px">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
                <span style="font-weight:600;font-size:15px">GitHub</span>
              </div>
              <span class="status-dot \${ghConnected ? 'status-dot-connected' : 'status-dot-disconnected'}"></span>
            </div>
            \${ghConnected && ghAccount && ghAccount.login ? '<p style="font-size:14px;color:var(--muted);margin-bottom:8px">@' + ghAccount.login + '</p>' : '<p style="font-size:14px;color:var(--muted);margin-bottom:8px">Not connected</p>'}
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-size:13px;color:var(--muted)">Repos: <strong class="font-mono" style="color:var(--fg)">\${enabledRepos} selected</strong></span>
            </div>
            <div style="margin-top:10px;display:flex;align-items:center;gap:4px;font-size:14px;color:var(--primary);font-weight:500">Configure <span style="font-size:14px">&rarr;</span></div>
          </div>

          <div class="card source-tile" style="cursor:pointer" onclick="switchTab('settings')">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              <span style="font-weight:600;font-size:15px">Audit Log</span>
            </div>
            <span style="font-size:14px;color:var(--muted)"><strong class="font-mono" style="color:var(--fg)">\${state.audit.length}</strong> events recorded</span>
            <div style="margin-top:10px;display:flex;align-items:center;gap:4px;font-size:14px;color:var(--primary);font-weight:500">View log <span style="font-size:14px">&rarr;</span></div>
          </div>
        </div>

        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <h2 style="margin:0">Recent Activity</h2>
            \${state.audit.length ? '<button class="btn btn-sm" style="font-size:12px;padding:4px 10px;color:var(--destructive);border-color:var(--destructive)" onclick="clearAuditLog()">Clear history</button>' : ''}
          </div>
          \${recentHtml}
        </div>
      \`;
    }

    function renderGmailTab() {
      var gmail = state.sources.find(function(s) { return s.name === 'gmail'; });
      var s = state.gmail;
      var realStaging = state.staging.filter(function(a) { return a.source === 'gmail'; });
      var gmailStaging = realStaging;
      var pendingCount = gmailStaging.filter(function(a) { return a.status === 'pending'; }).length;

      var gmailFilters = (state.filters || []).filter(function(f) { return f.source === 'gmail'; });

      var gmailConnected = gmail && gmail.connected;
      var gmailAccount = gmail && gmail.accountInfo;
      var accountEmail = gmailAccount && gmailAccount.email ? gmailAccount.email : '';

      // Emails are already filtered server-side via /api/gmail/preview
      var emails = state.realEmails || DEMO_EMAILS;
      var visibleEmails = emails;

      // Disconnected state
      if (!gmailConnected) {
        return '<div style="max-width:480px;margin:60px auto;text-align:center">' +
          '<h1 style="font-size:24px;font-weight:700;margin-bottom:8px">Gmail</h1>' +
          '<p style="font-size:14px;color:var(--muted);margin-bottom:4px">Connect your Gmail account to browse and control agent access to your emails.</p>' +
          '<p style="font-size:14px;color:var(--muted);margin-bottom:24px;opacity:0.7">Powered by OAuth &mdash; we never store your password.</p>' +
          '<button class="btn btn-primary" onclick="startOAuth(\\'gmail\\')" style="gap:8px">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>' +
            'Connect Gmail</button></div>';
      }

      // Build email list (emails are already filtered server-side)
      var emailListHtml = '';
      visibleEmails.forEach(function(em) {
        var isExpanded = state.expandedEmail === em.id;
        var safe = em.id.replace(/'/g, "\\\\'");
        var dt = new Date(em.date);
        var timeStr = dt.toLocaleDateString(undefined, { month:'short', day:'numeric' });

        emailListHtml += '<div class="email-row">';
        emailListHtml += '<button class="email-row-btn" onclick="toggleEmailExpand(\\'' + safe + '\\')">';
        emailListHtml += '<div style="display:flex;gap:12px;width:100%">';
        emailListHtml += '<div class="email-row-vis email-row-vis-on"></div>';
        emailListHtml += '<div style="flex:1;min-width:0">';
        emailListHtml += '<div style="display:flex;align-items:center;gap:8px">';
        emailListHtml += '<span class="email-row-sender">' + escapeHtml(em.from) + '</span>';
        if (em.hasAttachment) emailListHtml += '<svg class="email-row-attach" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
        emailListHtml += '<span class="email-row-date" style="margin-left:auto">' + timeStr + '</span>';
        emailListHtml += '</div>';
        emailListHtml += '<div class="email-row-subject">' + escapeHtml(em.subject) + '</div>';
        if (em.snippet) emailListHtml += '<div class="email-row-snippet">' + escapeHtml(em.snippet) + '</div>';
        if (em.labels && em.labels.length) {
          emailListHtml += '<div class="email-row-labels">';
          em.labels.forEach(function(l) { emailListHtml += '<span class="email-label">' + escapeHtml(l) + '</span>'; });
          emailListHtml += '</div>';
        }
        emailListHtml += '</div>';
        emailListHtml += '</div></button>';

        if (isExpanded) {
          emailListHtml += '<div class="email-expand">';
          emailListHtml += '<div class="email-expand-field"><span class="field-label">From</span><span class="field-value">' + escapeHtml(em.from) + '</span></div>';
          emailListHtml += '<div class="email-expand-field"><span class="field-label">To</span><span class="field-value">' + escapeHtml(em.to) + '</span></div>';
          emailListHtml += '<div class="email-expand-field"><span class="field-label">Subject</span><span class="field-value">' + escapeHtml(em.subject) + '</span></div>';
          if (em.labels && em.labels.length) {
            emailListHtml += '<div class="email-expand-field"><span class="field-label">Labels</span><span class="field-value">' + em.labels.map(function(l) { return escapeHtml(l); }).join(', ') + '</span></div>';
          }
          if (em.hasAttachment) {
            emailListHtml += '<div class="email-expand-field"><span class="field-label">Attach.</span><span class="field-value">' + (em.attachments ? em.attachments.map(function(a) { return escapeHtml(a); }).join(', ') : 'Yes') + '</span></div>';
          }
          emailListHtml += '<div class="email-expand-body"><pre>' + escapeHtml(em.body) + '</pre></div>';
          emailListHtml += '</div>';
        }
        emailListHtml += '</div>';
      });

      // Build action cards
      var actionHtml = '';
      gmailStaging.forEach(function(a) {
        var data = typeof a.action_data === 'string' ? JSON.parse(a.action_data) : a.action_data;
        var isPending = a.status === 'pending';
        var isReviewing = state.editingAction === a.action_id;
        var safe = a.action_id.replace(/'/g, "\\\\'");
        var borderClass = isPending ? 'border-left:3px solid var(--warning)' : a.status === 'approved' ? 'border-left:3px solid var(--success);opacity:0.6' : 'border-left:3px solid var(--destructive);opacity:0.6';
        var statusClass = isPending ? 'pending' : a.status === 'approved' ? 'connected' : 'rejected';
        var typeLabel = a.action_type === 'reply_email' ? 'reply' : a.action_type === 'draft_email' ? 'draft' : a.action_type;
        var time = new Date(a.proposed_at || a.createdAt);
        var timeStr = time.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });

        actionHtml += '<div class="card" style="padding:16px;' + borderClass + '">';
        actionHtml += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
        actionHtml += '<div style="display:flex;align-items:center;gap:6px">';
        actionHtml += '<span class="status ' + statusClass + '" style="font-size:14px;font-family:JetBrains Mono,monospace;text-transform:uppercase;padding:2px 8px">' + a.status + '</span>';
        actionHtml += '<span style="font-size:14px;font-family:JetBrains Mono,monospace;color:var(--muted);text-transform:uppercase">' + typeLabel + '</span>';
        actionHtml += '</div>';
        actionHtml += '<span style="font-size:14px;font-family:JetBrains Mono,monospace;color:var(--muted)">' + timeStr + '</span>';
        actionHtml += '</div>';
        if (a.purpose) actionHtml += '<p style="font-size:14px;color:var(--muted);margin-bottom:8px">' + escapeHtml(a.purpose) + '</p>';

        // Collapsed: show To, Subj, truncated body
        if (!isReviewing) {
          actionHtml += '<div style="font-size:14px;display:flex;flex-direction:column;gap:4px">';
          actionHtml += '<div style="display:flex;gap:8px"><span style="color:var(--muted);width:36px;flex-shrink:0">To:</span><span class="font-mono" style="color:var(--fg)">' + escapeHtml(data.to || '') + '</span></div>';
          actionHtml += '<div style="display:flex;gap:8px"><span style="color:var(--muted);width:36px;flex-shrink:0">Subj:</span><span class="font-mono" style="color:var(--fg)">' + escapeHtml(data.subject || '') + '</span></div>';
          actionHtml += '<pre class="font-mono" style="white-space:pre-wrap;background:rgba(0,0,0,0.03);border-radius:6px;padding:8px;font-size:14px;color:var(--fg);max-height:80px;overflow:hidden;margin-top:4px;cursor:pointer;position:relative" onclick="toggleEditAction(\\'' + safe + '\\')">' + escapeHtml(data.body || '') + '<span style="position:absolute;bottom:0;left:0;right:0;height:28px;background:linear-gradient(transparent,#f5f5f5);pointer-events:none"></span></pre>';
          actionHtml += '</div>';
        }

        // Expanded: full editable view
        if (isReviewing) {
          actionHtml += '<div style="font-size:14px;display:flex;flex-direction:column;gap:6px">';
          actionHtml += '<div style="display:flex;align-items:center;gap:8px"><span style="color:var(--muted);width:36px;flex-shrink:0">To:</span><input type="text" class="email-edit-input" id="edit-to-' + a.action_id + '" value="' + escapeAttr(data.to || '') + '" style="font-family:JetBrains Mono,monospace;font-size:14px;padding:4px 8px"></div>';
          actionHtml += '<div style="display:flex;align-items:center;gap:8px"><span style="color:var(--muted);width:36px;flex-shrink:0">Subj:</span><input type="text" class="email-edit-input" id="edit-subj-' + a.action_id + '" value="' + escapeAttr(data.subject || '') + '" style="font-family:JetBrains Mono,monospace;font-size:14px;padding:4px 8px"></div>';
          actionHtml += '<div><span style="color:var(--muted);display:block;margin-bottom:4px">Body:</span><textarea class="email-body-edit" id="edit-body-' + a.action_id + '" style="font-family:JetBrains Mono,monospace;font-size:14px;min-height:160px">' + escapeHtml(data.body || '') + '</textarea></div>';
          actionHtml += '</div>';
        }

        // Buttons
        if (isPending) {
          actionHtml += '<div style="display:flex;align-items:center;gap:6px;margin-top:12px">';
          if (!isReviewing) {
            actionHtml += '<button class="btn btn-sm btn-outline" style="gap:4px" onclick="toggleEditAction(\\'' + safe + '\\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Review</button>';
          } else {
            actionHtml += '<button class="btn btn-sm btn-outline" style="color:var(--destructive);border-color:rgba(239,68,68,0.3);gap:4px" onclick="resolveAction(\\'' + safe + '\\', \\'reject\\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Deny</button>';
            actionHtml += '<button class="btn btn-sm" style="background:var(--primary);color:#fff;gap:4px" onclick="approveAction(\\'' + safe + '\\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg> Save to Draft</button>';
            actionHtml += '<button class="btn btn-sm" style="background:var(--success);color:#fff;gap:4px" onclick="sendAction(\\'' + safe + '\\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send</button>';
          }
          actionHtml += '</div>';
        }
        actionHtml += '</div>';
      });
      if (!actionHtml) actionHtml = '<div class="card" style="padding:24px;text-align:center;color:var(--muted);font-size:14px">No pending actions from agents.</div>';

      return \`
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px">
          <div style="display:flex;align-items:center;gap:16px">
            <div>
              <h1 style="font-size:24px;font-weight:700;letter-spacing:-0.5px;color:var(--fg)">Gmail</h1>
              \${accountEmail ? '<p style="font-size:13px;color:var(--muted);margin-top:2px">' + escapeHtml(accountEmail) + '</p>' : ''}
            </div>
          </div>
          <button class="btn btn-outline btn-sm" style="color:var(--destructive);border-color:rgba(239,68,68,0.3)" onclick="if(confirm('Disconnect Gmail? This will revoke all access tokens and disable Gmail access for all agents.')){disconnectSource('gmail')}">Disconnect</button>
        </div>

        <div class="card" style="padding:20px;margin-bottom:16px">
          <label style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.8px;display:block;margin-bottom:14px">Quick Filters</label>
          \${renderFilterCards(gmailFilters)}
        </div>

        <div class="gmail-grid">
          <div class="gmail-grid-left">
            <div class="action-review-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted)"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <h2 style="margin:0">Agent Access Preview</h2>
            </div>
            <div class="card" style="padding:0;overflow:hidden">
              <div class="email-list-header">
                <span class="stat">Showing: <strong>\${visibleEmails.length}</strong> emails</span>
                \${!state.realEmails && gmailConnected && !state.emailsLoading ? '<span style="margin-left:auto;font-size:12px;color:var(--muted);opacity:0.7">Sample data</span>' : ''}
                \${state.realEmails && gmailConnected ? '<button onclick="refreshEmails()" style="margin-left:auto;background:none;border:1px solid var(--border);border-radius:4px;padding:2px 10px;font-size:12px;color:var(--muted);cursor:pointer">Refresh</button>' : ''}
              </div>
              \${state.emailsLoading
                ? '<div style="padding:40px;text-align:center"><p style="color:var(--muted);font-size:14px">Loading emails from Gmail...</p></div>'
                : state.emailsError
                  ? '<div style="padding:40px;text-align:center"><p style="color:var(--destructive);font-size:14px">Error: ' + escapeHtml(state.emailsError) + '</p><button class="btn btn-primary" onclick="refreshEmails()" style="margin-top:12px">Retry</button></div>'
                  : (emailListHtml || '<p class="empty" style="padding:40px">No emails found.</p>')}
            </div>
          </div>

          <div class="gmail-grid-right">
            <div class="action-review-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted)"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <h2 style="margin:0">Agent Action Review</h2>
              \${pendingCount ? '<span class="nav-badge">' + pendingCount + '</span>' : ''}
            </div>
            \${actionHtml}
          </div>
        </div>
        </div>
      \`;
    }

    function renderCalendarTab() {
      var cal = state.sources.find(function(s) { return s.name === 'google_calendar'; });
      var realStaging = state.staging.filter(function(a) { return a.source === 'google_calendar'; });
      var calStaging = realStaging;
      var pendingCount = calStaging.filter(function(a) { return a.status === 'pending'; }).length;

      var calFilters = (state.filters || []).filter(function(f) { return f.source === 'google_calendar'; });

      var calConnected = cal && cal.connected;
      var calAccount = cal && cal.accountInfo;
      var accountEmail = calAccount && calAccount.email ? calAccount.email : '';

      var events = state.realEvents || [];
      // Sort events by start date descending (most recent at top)
      var sortedEvents = events.slice().sort(function(a, b) {
        return new Date(b.start).getTime() - new Date(a.start).getTime();
      });
      var visibleEvents = sortedEvents;

      // Disconnected state
      if (!calConnected) {
        return '<div style="max-width:480px;margin:60px auto;text-align:center">' +
          '<h1 style="font-size:24px;font-weight:700;margin-bottom:8px">Calendar</h1>' +
          '<p style="font-size:14px;color:var(--muted);margin-bottom:4px">Connect your Google Calendar account to control agent access to your events.</p>' +
          '<p style="font-size:14px;color:var(--muted);margin-bottom:24px;opacity:0.7">Powered by OAuth &mdash; we never store your password.</p>' +
          '<button class="btn btn-primary" onclick="startOAuth(\\'google_calendar\\')" style="gap:8px">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
            'Connect Calendar</button></div>';
      }

      // Build event list
      var eventListHtml = '';
      visibleEvents.forEach(function(ev) {
        var safe = ev.id.replace(/'/g, "\\\\'");
        var dt = new Date(ev.start);
        var timeStr = dt.toLocaleDateString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });

        eventListHtml += '<div class="email-row" style="padding:12px 16px">';
        eventListHtml += '<div style="display:flex;gap:12px;width:100%">';
        eventListHtml += '<div class="email-row-vis email-row-vis-on"></div>';
        eventListHtml += '<div style="flex:1;min-width:0">';
        eventListHtml += '<div style="display:flex;align-items:center;gap:8px">';
        eventListHtml += '<span class="email-row-sender">' + escapeHtml(ev.title) + '</span>';
        eventListHtml += '<span class="email-row-date" style="margin-left:auto">' + timeStr + '</span>';
        eventListHtml += '</div>';
        if (ev.location) eventListHtml += '<div style="font-size:12px;color:var(--muted);margin-top:2px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' + escapeHtml(ev.location) + '</div>';
        if (ev.body) eventListHtml += '<div class="email-row-snippet" style="margin-top:4px">' + escapeHtml(ev.body) + '</div>';
        eventListHtml += '</div>';
        eventListHtml += '</div>';
        eventListHtml += '</div>';
      });

      // Build action cards
      var actionHtml = '';
      calStaging.forEach(function(a) {
        var data = typeof a.action_data === 'string' ? JSON.parse(a.action_data) : a.action_data;
        var isPending = a.status === 'pending';
        var safe = a.action_id.replace(/'/g, "\\\\'");
        var borderClass = isPending ? 'border-left:3px solid var(--warning)' : a.status === 'approved' ? 'border-left:3px solid var(--success);opacity:0.6' : 'border-left:3px solid var(--destructive);opacity:0.6';
        var statusClass = isPending ? 'pending' : a.status === 'approved' ? 'connected' : 'rejected';
        var typeLabel = a.action_type.replace('_event', '');
        var time = new Date(a.proposed_at || a.createdAt);
        var timeStr = time.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });

        actionHtml += '<div class="card" style="padding:16px;' + borderClass + '">';
        actionHtml += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
        actionHtml += '<div style="display:flex;align-items:center;gap:6px">';
        actionHtml += '<span class="status ' + statusClass + '" style="font-size:14px;font-family:JetBrains Mono,monospace;text-transform:uppercase;padding:2px 8px">' + a.status + '</span>';
        actionHtml += '<span style="font-size:14px;font-family:JetBrains Mono,monospace;color:var(--muted);text-transform:uppercase">' + typeLabel + '</span>';
        actionHtml += '</div>';
        actionHtml += '<span style="font-size:14px;font-family:JetBrains Mono,monospace;color:var(--muted)">' + timeStr + '</span>';
        actionHtml += '</div>';
        if (a.purpose) actionHtml += '<p style="font-size:14px;color:var(--muted);margin-bottom:8px">' + escapeHtml(a.purpose) + '</p>';

        actionHtml += '<div style="font-size:14px;display:flex;flex-direction:column;gap:4px">';
        actionHtml += '<div style="display:flex;gap:8px"><span style="color:var(--muted);width:48px;flex-shrink:0">Event:</span><span class="font-mono" style="color:var(--fg)">' + escapeHtml(data.title || '') + '</span></div>';
        if (data.start) actionHtml += '<div style="display:flex;gap:8px"><span style="color:var(--muted);width:48px;flex-shrink:0">Start:</span><span class="font-mono" style="color:var(--fg)">' + new Date(data.start).toLocaleString() + '</span></div>';
        actionHtml += '</div>';

        if (isPending) {
          actionHtml += '<div style="display:flex;align-items:center;gap:6px;margin-top:12px">';
          actionHtml += '<button class="btn btn-sm btn-outline" style="color:var(--destructive);border-color:rgba(239,68,68,0.3);gap:4px" onclick="resolveAction(\\'' + safe + '\\', \\'reject\\')">Deny</button>';
          actionHtml += '<button class="btn btn-sm" style="background:var(--success);color:#fff;gap:4px" onclick="resolveAction(\\'' + safe + '\\', \\'approve\\')">Approve</button>';
          actionHtml += '</div>';
        }
        actionHtml += '</div>';
      });
      if (!actionHtml) actionHtml = '<div class="card" style="padding:24px;text-align:center;color:var(--muted);font-size:14px">No pending actions.</div>';

      return \`
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px">
          <div style="display:flex;align-items:center;gap:16px">
            <div>
              <h1 style="font-size:24px;font-weight:700;letter-spacing:-0.5px;color:var(--fg)">Calendar</h1>
              \${accountEmail ? '<p style="font-size:13px;color:var(--muted);margin-top:2px">' + escapeHtml(accountEmail) + '</p>' : ''}
            </div>
          </div>
          <button class="btn btn-outline btn-sm" style="color:var(--destructive);border-color:rgba(239,68,68,0.3)" onclick="if(confirm('Disconnect Calendar?')){disconnectSource('google_calendar')}">Disconnect</button>
        </div>

        <div class="card" style="padding:20px;margin-bottom:16px">
          <label style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.8px;display:block;margin-bottom:14px">Quick Filters</label>
          \${renderCalendarFilterCards(calFilters)}
        </div>

        <div class="gmail-grid">
          <div class="gmail-grid-left">
            <div class="action-review-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted)"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <h2 style="margin:0">Agent Access Preview</h2>
            </div>
            <div class="card" style="padding:0;overflow:hidden">
              <div class="email-list-header">
                <span class="stat">Showing: <strong>\${visibleEvents.length}</strong> events</span>
                \${calConnected && !state.eventsLoading ? '<button onclick="refreshCalendarEvents()" style="margin-left:auto;background:none;border:1px solid var(--border);border-radius:4px;padding:2px 10px;font-size:12px;color:var(--muted);cursor:pointer">Refresh</button>' : ''}
              </div>
              \${state.eventsLoading
                ? '<div style="padding:40px;text-align:center"><p style="color:var(--muted);font-size:14px">Loading events...</p></div>'
                : (eventListHtml || '<p class="empty" style="padding:40px">No events found.</p>')}
            </div>
          </div>

          <div class="gmail-grid-right">
            <div class="action-review-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted)"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <h2 style="margin:0">Agent Action Review</h2>
              \${pendingCount ? '<span class="nav-badge">' + pendingCount + '</span>' : ''}
            </div>
            \${actionHtml}
          </div>
        </div>
      \`;
    }

    function renderGitHubTab() {
      var github = state.sources.find(function(s) { return s.name === 'github'; });
      var ghConnected = github && github.connected;
      var ghAccount = github && github.accountInfo;
      var allRepos = state.github.repoList || [];

      // Auto-fetch repos on first render when connected
      if (ghConnected && !state.github.reposLoaded && !state.github.reposLoading) {
        fetchGithubRepos();
      }

      // Collect all unique owners for the dropdown
      var allOwners = [];
      var ownerSeen = {};
      allRepos.forEach(function(r) {
        if (!ownerSeen[r.owner]) { ownerSeen[r.owner] = true; allOwners.push({ name: r.owner, is_org: r.is_org }); }
      });
      allOwners.sort(function(a, b) {
        if (a.is_org !== b.is_org) return a.is_org ? 1 : -1;
        return a.name.localeCompare(b.name);
      });

      // Filter repos by owner and search
      var filtered = allRepos;
      if (state.github.filterOwner) {
        filtered = filtered.filter(function(r) { return r.owner === state.github.filterOwner; });
      }
      if (state.github.search) {
        var q = state.github.search.toLowerCase();
        filtered = filtered.filter(function(r) {
          return r.full_name.toLowerCase().indexOf(q) !== -1 || (r.description && r.description.toLowerCase().indexOf(q) !== -1);
        });
      }

      // Group filtered repos by owner
      var groups = {};
      filtered.forEach(function(r) {
        if (!groups[r.owner]) groups[r.owner] = [];
        groups[r.owner].push(r);
      });
      var ownerKeys = Object.keys(groups).sort();
      ownerKeys.sort(function(a, b) {
        var aIsOrg = groups[a][0].is_org;
        var bIsOrg = groups[b][0].is_org;
        if (aIsOrg !== bIsOrg) return aIsOrg ? 1 : -1;
        return a.localeCompare(b);
      });

      var repoHtml = '';
      if (state.github.reposLoading) {
        repoHtml = '<p class="empty" style="display:flex;align-items:center;justify-content:center;gap:8px"><span class="spinner"></span> Loading repositories from GitHub...</p>';
      } else if (ghConnected && !allRepos.length) {
        repoHtml = '<p class="empty">No repositories found. Click "Refresh repos" to fetch.</p>';
      } else if (ghConnected && !filtered.length) {
        repoHtml = '<p class="empty">No repositories match your filter.</p>';
      } else if (ghConnected) {
        ownerKeys.forEach(function(owner) {
          var ownerRepos = groups[owner];
          var isOrg = ownerRepos[0].is_org;
          var enabledCount = ownerRepos.filter(function(r) { return r.enabled; }).length;
          repoHtml += '<div style="margin-bottom:16px">';
          repoHtml += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">';
          repoHtml += '<h3 style="font-size:14px;margin:0">' + escapeHtml(owner) + '</h3>';
          repoHtml += '<span class="status ' + (isOrg ? 'pending' : 'connected') + '">' + (isOrg ? 'org' : 'personal') + '</span>';
          repoHtml += '<span style="font-size:14px;color:#888">' + enabledCount + '/' + ownerRepos.length + ' selected</span>';
          repoHtml += '<span class="sel-links">(<a onclick="selectAllOwner(\\'' + escapeAttr(owner) + '\\', true)">all</a> / <a onclick="selectAllOwner(\\'' + escapeAttr(owner) + '\\', false)">none</a>)</span>';
          repoHtml += '</div>';

          ownerRepos.forEach(function(repo) {
            var perms = typeof repo.permissions === 'string' ? JSON.parse(repo.permissions) : repo.permissions;
            var hasCodeRead = perms.indexOf('contents:read') !== -1;
            var hasCodeWrite = perms.indexOf('contents:write') !== -1;
            var hasIssuesRead = perms.indexOf('issues:read') !== -1;
            var hasIssuesWrite = perms.indexOf('issues:write') !== -1;
            var hasPrsRead = perms.indexOf('pull_requests:read') !== -1;
            var hasPrsWrite = perms.indexOf('pull_requests:write') !== -1;
            var exp = state.expandedRepos[repo.full_name];
            var safe = repo.full_name.replace(/'/g, "\\\\'");
            repoHtml += '<div class="repo-item">';
            repoHtml += '<div class="repo-header" onclick="toggleRepo(\\'' + safe + '\\')">';
            repoHtml += '<input type="checkbox" ' + chk(repo.enabled) + ' onclick="event.stopPropagation(); toggleRepoEnabled(\\'' + safe + '\\', this.checked)" title="Enable access">';
            repoHtml += '<span class="repo-name">' + escapeHtml(repo.name) + '</span>';
            if (repo.private) repoHtml += '<span class="status disconnected" style="font-size:14px;padding:2px 6px">private</span>';
            if (repo.description) repoHtml += '<span style="font-size:14px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px">' + escapeHtml(repo.description) + '</span>';
            repoHtml += '<span class="repo-chevron ' + (exp ? 'open' : '') + '">&#9654;</span>';
            repoHtml += '</div>';
            repoHtml += '<div class="repo-perms ' + (exp ? 'show' : '') + '">';
            repoHtml += '<div style="display:flex;align-items:center;gap:6px;padding:8px 0">';
            repoHtml += '<span style="font-size:14px;font-weight:700;color:var(--fg)">Contents</span>';
            repoHtml += '<div class="toggle" style="margin:0"><input type="checkbox" ' + chk(hasCodeRead) + ' onchange="toggleRepoPerm(\\'' + safe + '\\', \\'contents:read\\', this.checked)"><label>read</label></div>';
            repoHtml += '<div class="toggle" style="margin:0"><input type="checkbox" ' + chk(hasCodeWrite) + ' onchange="toggleRepoPerm(\\'' + safe + '\\', \\'contents:write\\', this.checked)"><label>write</label></div>';
            repoHtml += '<span style="color:#ddd;margin:0 4px">|</span>';
            repoHtml += '<span style="font-size:14px;font-weight:700;color:var(--fg)">Issues</span>';
            repoHtml += '<div class="toggle" style="margin:0"><input type="checkbox" ' + chk(hasIssuesRead) + ' onchange="toggleRepoPerm(\\'' + safe + '\\', \\'issues:read\\', this.checked)"><label>read</label></div>';
            repoHtml += '<div class="toggle" style="margin:0"><input type="checkbox" ' + chk(hasIssuesWrite) + ' onchange="toggleRepoPerm(\\'' + safe + '\\', \\'issues:write\\', this.checked)"><label>write</label></div>';
            repoHtml += '<span style="color:#ddd;margin:0 4px">|</span>';
            repoHtml += '<span style="font-size:14px;font-weight:700;color:var(--fg)">Pull Requests</span>';
            repoHtml += '<div class="toggle" style="margin:0"><input type="checkbox" ' + chk(hasPrsRead) + ' onchange="toggleRepoPerm(\\'' + safe + '\\', \\'pull_requests:read\\', this.checked)"><label>read</label></div>';
            repoHtml += '<div class="toggle" style="margin:0"><input type="checkbox" ' + chk(hasPrsWrite) + ' onchange="toggleRepoPerm(\\'' + safe + '\\', \\'pull_requests:write\\', this.checked)"><label>write</label></div>';
            repoHtml += '</div></div></div>';
          });
          repoHtml += '</div>';
        });
      }

      // Build owner select options
      var ownerOptions = '<option value="">All accounts</option>';
      allOwners.forEach(function(o) {
        ownerOptions += '<option value="' + escapeAttr(o.name) + '"' + (state.github.filterOwner === o.name ? ' selected' : '') + '>' + escapeHtml(o.name) + (o.is_org ? ' (org)' : '') + '</option>';
      });

      return \`
        <div class="card">
          <h2>Connection Status</h2>
          \${ghConnected
            ? '<div style="display:flex;align-items:center;gap:10px"><span class="status-dot status-dot-connected"></span><span class="status connected">Connected</span></div>' +
              (ghAccount && ghAccount.login ? '<p style="margin-top:8px;font-size:14px">Signed in as <strong class="font-mono">@' + ghAccount.login + '</strong></p>' : '') +
              '<div class="actions"><button class="btn btn-danger btn-sm" onclick="disconnectSource(\\'github\\')">Disconnect</button></div>'
            : '<div style="display:flex;align-items:center;gap:10px"><span class="status-dot status-dot-disconnected"></span><span class="status disconnected">' + (github?.enabled ? 'Not connected' : 'Not configured') + '</span></div>' +
              '<div class="actions"><button class="btn btn-primary" onclick="startOAuth(\\'github\\')">Connect GitHub</button></div>'
          }
        </div>

        \${ghConnected ? '<div class="card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">Repositories <span class="save-flash" id="github-flash">Saved</span></h2><button class="btn btn-outline btn-sm" onclick="fetchGithubRepos()">Refresh repos</button></div>' +
          '<div style="display:flex;align-items:center;gap:6px;padding:10px 14px;background:var(--sidebar-bg);border-radius:6px;margin-bottom:12px">' +
            '<span style="font-size:14px;font-weight:700;color:var(--fg);white-space:nowrap">Contents</span>' +
            '<div class="toggle" style="margin:0"><input type="checkbox" id="bulk-code-read" checked><label for="bulk-code-read" style="font-size:14px">read</label></div>' +
            '<div class="toggle" style="margin:0"><input type="checkbox" id="bulk-code-write"><label for="bulk-code-write" style="font-size:14px">write</label></div>' +
            '<span style="color:#ddd;margin:0 4px">|</span>' +
            '<span style="font-size:14px;font-weight:700;color:var(--fg);white-space:nowrap">Issues</span>' +
            '<div class="toggle" style="margin:0"><input type="checkbox" id="bulk-issues-read" checked><label for="bulk-issues-read" style="font-size:14px">read</label></div>' +
            '<div class="toggle" style="margin:0"><input type="checkbox" id="bulk-issues-write"><label for="bulk-issues-write" style="font-size:14px">write</label></div>' +
            '<span style="color:#ddd;margin:0 4px">|</span>' +
            '<span style="font-size:14px;font-weight:700;color:var(--fg);white-space:nowrap">Pull Requests</span>' +
            '<div class="toggle" style="margin:0"><input type="checkbox" id="bulk-prs-read" checked><label for="bulk-prs-read" style="font-size:14px">read</label></div>' +
            '<div class="toggle" style="margin:0"><input type="checkbox" id="bulk-prs-write"><label for="bulk-prs-write" style="font-size:14px">write</label></div>' +
            '<span style="flex:1"></span>' +
            '<button class="btn btn-primary btn-sm" onclick="applyBulkPerms()">Apply to selected</button>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' +
            '<select style="width:auto;min-width:140px" onchange="state.github.filterOwner=this.value; render()">' + ownerOptions + '</select>' +
            '<input type="text" id="gh-repo-search" placeholder="Search repos..." value="' + escapeAttr(state.github.search) + '" oninput="state.github.search=this.value; render()" style="flex:1">' +
          '</div>' +
          repoHtml + '</div>' : ''}
      \`;
    }

    function renderSmsTab() {
      var sms = state.sms;
      var boxBtnStyle = function(b) {
        return 'padding:6px 14px;border-radius:6px;border:1px solid;font-size:13px;cursor:pointer;' +
          (sms.box === b
            ? 'background:var(--primary);color:#fff;border-color:var(--primary);'
            : 'background:none;color:var(--muted);border-color:var(--border);');
      };

      var listHtml = '';
      if (sms.loading) {
        listHtml = '<div style="padding:40px;text-align:center"><div class="spinner"></div><p style="margin-top:12px;color:var(--muted);font-size:14px">Loading messages…</p></div>';
      } else if (sms.error) {
        if (sms.error === 'PERMISSION_DENIED') {
          listHtml = '<div style="padding:32px;text-align:center">' +
            '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5" style="margin-bottom:12px"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.4 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16.92z"/></svg>' +
            '<p style="font-size:15px;font-weight:600;margin-bottom:6px">SMS Permission Required</p>' +
            '<p style="font-size:13px;color:var(--muted);margin-bottom:16px">Grant SMS permission in Android Settings to read messages.</p>' +
            '<button class="btn btn-primary" onclick="loadSmsMessages(true)">Request Permission</button>' +
            '</div>';
        } else if (sms.error === 'NOT_ANDROID') {
          listHtml = '<div style="padding:32px;text-align:center;color:var(--muted);font-size:14px">SMS reading is only available on Android.</div>';
        } else {
          listHtml = '<div style="padding:24px"><div class="status disconnected" style="font-size:13px">Error: ' + escapeHtml(sms.error) + '</div>' +
            '<button class="btn btn-outline btn-sm" style="margin-top:12px" onclick="loadSmsMessages(true)">Retry</button></div>';
        }
      } else if (!sms.messages) {
        listHtml = '<div style="padding:40px;text-align:center"><div class="spinner"></div></div>';
      } else if (sms.messages.length === 0) {
        listHtml = '<div style="padding:32px;text-align:center;color:var(--muted);font-size:14px">No messages in ' + sms.box + '.</div>';
      } else {
        sms.messages.forEach(function(msg) {
          var date = new Date(msg.date);
          var now = new Date();
          var diffMs = now - date;
          var diffH = diffMs / 3600000;
          var dateStr = diffH < 1 ? Math.round(diffMs / 60000) + 'm ago'
            : diffH < 24 ? Math.round(diffH) + 'h ago'
            : diffH < 48 ? 'Yesterday'
            : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          var unread = !msg.read;
          var body = msg.body || '';
          var snippet = body.length > 80 ? body.substring(0, 80) + '…' : body;
          listHtml += '<div class="email-row" data-address="' + escapeAttr(msg.address || '') + '" data-body="' + escapeAttr(body) + '" ontouchstart="smsLongPressStart(this)" ontouchend="smsLongPressEnd()" ontouchmove="smsLongPressEnd()" style="user-select:none;-webkit-user-select:none">' +
            '<div class="email-row-btn" style="display:flex;align-items:flex-start;gap:10px">' +
            (unread ? '<div style="width:6px;height:6px;border-radius:50%;background:var(--primary);flex-shrink:0;margin-top:5px"></div>' : '<div style="width:6px;flex-shrink:0"></div>') +
            '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
            '<span class="email-row-sender">' + escapeHtml(msg.address || 'Unknown') + '</span>' +
            '<span class="email-row-date">' + escapeHtml(dateStr) + '</span>' +
            '</div>' +
            '<div class="email-row-snippet">' + escapeHtml(snippet) + '</div>' +
            '</div></div></div>';
        });
      }

      var cm = sms.contextMenu;
      var cmHtml = '';
      if (cm) {
        var statusHtml = '';
        if (cm.status === 'thinking') {
          statusHtml = '<div style="display:flex;align-items:center;gap:10px;padding:14px 0;color:var(--muted);font-size:14px"><div class="spinner"></div>Generating reply…</div>';
        } else if (cm.status === 'sending') {
          statusHtml = '<div style="padding:14px 0;font-size:14px"><div style="color:var(--muted);font-size:12px;margin-bottom:6px">Sending:</div><div style="font-style:italic">"' + escapeHtml(cm.reply || '') + '"</div></div>';
        } else if (cm.status === 'sent') {
          statusHtml = '<div style="padding:14px 0;color:var(--success,#22c55e);font-size:14px">✓ Reply sent</div>';
        } else if (cm.status === 'error') {
          statusHtml = '<div style="padding:14px 0;color:var(--danger,#ef4444);font-size:13px">' + escapeHtml(cm.error || 'Error') + '</div>';
        }
        var isDone = cm.status === 'sent' || cm.status === 'error';
        cmHtml = '<div style="position:fixed;inset:0;z-index:200;background:rgba(0,0,0,0.45);display:flex;align-items:flex-end" onclick="hideSmsContextMenu()">' +
          '<div style="width:100%;background:var(--card-bg);border-radius:20px 20px 0 0;padding:20px;padding-bottom:calc(20px + env(safe-area-inset-bottom,0px))" onclick="event.stopPropagation()">' +
          '<div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 16px"></div>' +
          '<div style="font-weight:600;font-size:15px;margin-bottom:2px">' + escapeHtml(cm.address) + '</div>' +
          '<div style="font-size:13px;color:var(--muted);margin-bottom:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml((cm.body || '').slice(0, 60)) + '</div>' +
          statusHtml +
          (!cm.status || cm.status === 'error' ? '<button class="btn btn-primary" style="width:100%;margin-bottom:10px" onclick="manualAutoReply()">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
            'Reply automatically</button>' : '') +
          (isDone ? '<button class="btn btn-outline" style="width:100%" onclick="hideSmsContextMenu()">Close</button>' :
            '<button class="btn btn-outline" style="width:100%" onclick="hideSmsContextMenu()">Cancel</button>') +
          '</div></div>';
      }

      return \`
        <div class="card" style="padding:0;overflow:hidden">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)">
            <div style="display:flex;align-items:center;gap:10px">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.4 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16.92z"/></svg>
              <h2 style="margin:0">SMS Messages</h2>
              \${sms.messages ? '<span style="font-size:13px;color:var(--muted)">(' + sms.messages.length + ')</span>' : ''}
            </div>
            <button class="btn btn-outline btn-sm" onclick="loadSmsMessages(true)">Refresh</button>
          </div>
          <div style="display:flex;gap:6px;padding:12px 20px;border-bottom:1px solid var(--border)">
            <button style="\${boxBtnStyle('inbox')}" onclick="state.sms.box='inbox';loadSmsMessages(true)">Inbox</button>
            <button style="\${boxBtnStyle('sent')}" onclick="state.sms.box='sent';loadSmsMessages(true)">Sent</button>
            <button style="\${boxBtnStyle('all')}" onclick="state.sms.box='all';loadSmsMessages(true)">All</button>
          </div>
          \${listHtml}
        </div>
        \${cmHtml}
      \`;
    }

    // Callback registry for AndroidSms.getMessages() results delivered via
    // evaluateJavascript from SmsPlugin's JavascriptInterface.
    window._smsCbs = {};
    window._smsDeliver = function(callbackId, messages, error) {
      var cb = window._smsCbs[callbackId];
      if (cb) { delete window._smsCbs[callbackId]; cb(messages, error); }
    };

    function loadSmsMessages(force) {
      if (!force && state.sms.messages !== null) return;
      if (!force && state.sms.error) return;
      if (state.sms.loading) return;

      state.sms.loading = true;
      state.sms.error = null;
      if (currentTab === 'sms') render();

      if (!window.AndroidSms) {
        state.sms.loading = false;
        state.sms.error = 'NOT_ANDROID';
        if (currentTab === 'sms') render();
        return;
      }

      var reqId = Date.now().toString();
      var timer = setTimeout(function() {
        delete window._smsCbs[reqId];
        state.sms.loading = false;
        state.sms.error = 'Timed out reading SMS — check permission in Android Settings';
        if (currentTab === 'sms') render();
      }, 10000);

      window._smsCbs[reqId] = function(messages, error) {
        clearTimeout(timer);
        state.sms.loading = false;
        if (error) {
          var el = error.toLowerCase();
          state.sms.error = (el.includes('denied') || el.includes('permission'))
            ? 'PERMISSION_DENIED' : error;
        } else {
          state.sms.messages = messages;
          state.sms.error = null;
        }
        if (currentTab === 'sms') render();
      };

      window.AndroidSms.getMessages(reqId, state.sms.box, 100);
    }
    window.loadSmsMessages = loadSmsMessages;

    // ---- AI chat ----

    // Callback registry for AndroidSms.sendMessage() results
    window._smsSendCbs = {};
    window._smsSendDeliver = function(callbackId, error) {
      var cb = window._smsSendCbs[callbackId];
      if (cb) { delete window._smsSendCbs[callbackId]; cb(error); }
    };

    async function sendSmsAction(actionId, to, body) {
      if (!window.AndroidSms || !window.AndroidSms.sendMessage) {
        alert('SMS sending is only available on Android.');
        return;
      }
      var cbId = 'smssend_' + Date.now();
      window._smsSendCbs[cbId] = async function(error) {
        if (error && error !== 'null') {
          alert('Failed to send SMS: ' + error);
          return;
        }
        await fetch('/api/staging/' + actionId + '/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'approve' }),
        });
        state.chat.stagedSmsIds = state.chat.stagedSmsIds.filter(function(id) { return id !== actionId; });
        await fetchData();
      };
      window.AndroidSms.sendMessage(cbId, to, body);
    }
    window.sendSmsAction = sendSmsAction;

    // Long-press context menu for SMS messages
    var _smsLongPressTimer = null;
    function smsLongPressStart(el) {
      var address = el.getAttribute('data-address');
      var body = el.getAttribute('data-body');
      _smsLongPressTimer = setTimeout(function() {
        _smsLongPressTimer = null;
        // Haptic feedback if available
        if (navigator.vibrate) navigator.vibrate(40);
        state.sms.contextMenu = { address: address, body: body, status: null };
        render();
      }, 600);
    }
    function smsLongPressEnd() {
      if (_smsLongPressTimer) { clearTimeout(_smsLongPressTimer); _smsLongPressTimer = null; }
    }
    function hideSmsContextMenu() {
      state.sms.contextMenu = null;
      state.sms.autoReplying = false;
      render();
    }
    async function manualAutoReply() {
      var cm = state.sms.contextMenu;
      if (!cm || state.sms.autoReplying) return;
      if (!window.AndroidSms) { alert('SMS is only available on Android.'); return; }
      state.sms.autoReplying = true;
      state.sms.contextMenu = Object.assign({}, cm, { status: 'thinking' });
      render();
      try {
        var res = await fetch('/api/sms/manual-reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: cm.address, body: cm.body }),
        });
        var d = await res.json();
        if (!d.ok || !d.reply) {
          state.sms.contextMenu = Object.assign({}, cm, { status: 'error', error: d.error || 'No reply generated' });
          state.sms.autoReplying = false;
          render();
          return;
        }
        state.sms.contextMenu = Object.assign({}, cm, { status: 'sending', reply: d.reply });
        render();
        var cbId = 'manual_' + Date.now();
        window._smsSendCbs[cbId] = function(error) {
          if (error && error !== 'null') {
            state.sms.contextMenu = Object.assign({}, state.sms.contextMenu, { status: 'error', error: 'Send failed: ' + error });
          } else {
            state.sms.contextMenu = Object.assign({}, state.sms.contextMenu, { status: 'sent' });
          }
          state.sms.autoReplying = false;
          render();
        };
        window.AndroidSms.sendMessage(cbId, cm.address, d.reply);
      } catch(e) {
        state.sms.contextMenu = Object.assign({}, cm, { status: 'error', error: e.message || 'Network error' });
        state.sms.autoReplying = false;
        render();
      }
    }
    window.smsLongPressStart = smsLongPressStart;
    window.smsLongPressEnd = smsLongPressEnd;
    window.hideSmsContextMenu = hideSmsContextMenu;
    window.manualAutoReply = manualAutoReply;

    async function rejectSmsAction(actionId) {
      await fetch('/api/staging/' + actionId + '/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'reject' }),
      });
      state.chat.stagedSmsIds = state.chat.stagedSmsIds.filter(function(id) { return id !== actionId; });
      await fetchData();
    }
    window.rejectSmsAction = rejectSmsAction;

    function renderMemoryTab() {
      var mem = state.memories;
      var total = mem.items.length;
      var percent = Math.min(100, Math.round((total / 50) * 100));

      var html = '<div class="flex flex-col h-full bg-background">';

      // TopBar
      html += '<header class="flex justify-between items-center px-margin h-16 border-b border-outline-variant bg-surface shrink-0">';
      html += '<div class="flex items-center gap-sm">';
      html += '<span class="material-symbols-outlined text-primary">smart_toy</span>';
      html += '<h1 class="font-headline-md text-headline-md font-bold text-primary">AI Studio</h1>';
      html += '</div>';
      html += '</header>';

      // Content area
      html += '<div class="flex-grow overflow-y-auto px-margin py-md space-y-md max-w-2xl mx-auto w-full pb-24">';

      // Title & Capacity block
      html += '<div class="flex justify-between items-end pb-xs border-b border-outline-variant/60">';
      html += '<div class="flex flex-col gap-base">';
      html += '<h2 class="font-headline-lg text-headline-lg text-on-surface">AI Memory</h2>';
      html += '<div class="flex items-center gap-sm">';
      html += '<div class="w-32 h-1.5 bg-surface-container-highest rounded-full overflow-hidden">';
      html += '<div class="h-full bg-primary" style="width: ' + percent + '%"></div>';
      html += '</div>';
      html += '<span class="font-label-sm text-label-sm text-on-surface-variant">' + total + ' / 50 memories saved</span>';
      html += '</div>';
      html += '</div>';
      html += '<button onclick="toggleAddMemory()" class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-4 py-2 rounded-xl transition-all active:scale-95 flex items-center gap-xs shadow-sm">';
      html += '<span class="material-symbols-outlined text-[18px]">add</span>';
      html += '<span>' + (mem.adding ? 'Cancel' : 'Add memory') + '</span>';
      html += '</button>';
      html += '</div>';

      // Error banner
      if (mem.error) {
        html += '<div class="p-md bg-error-container text-on-error-container border border-error/20 rounded-xl font-body-sm text-body-sm shadow-sm">' + escapeHtml(mem.error) + '</div>';
      }

      // Add memory form
      if (mem.adding) {
        html += '<div class="bg-surface-container-low border border-primary/40 rounded-xl p-md space-y-sm shadow-md">';
        html += '<p class="font-label-caps text-label-caps text-on-surface-variant">What should the AI remember?</p>';
        html += '<textarea id="new-memory-input" onchange="updateNewMemoryContent(this.value)" oninput="updateNewMemoryContent(this.value)" placeholder="e.g. Prefers concise replies. Works in timezone UTC+5:30." class="w-full bg-white border border-outline-variant rounded-lg p-md text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm min-h-[80px]" rows="2">' + escapeHtml(mem.newContent) + '</textarea>';
        html += '<div class="flex gap-sm pt-xs">';
        html += '<button onclick="submitNewMemory()" class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-6 py-2 rounded-xl transition-all active:scale-95">Save</button>';
        html += '<button onclick="toggleAddMemory()" class="border border-outline text-on-surface-variant hover:bg-surface-container-high font-label-caps text-label-caps px-6 py-2 rounded-xl transition-all active:scale-95">Cancel</button>';
        html += '</div>';
        html += '</div>';
      }

      // Loading / Empty / List
      if (mem.loading && !total) {
        html += '<div class="flex items-center justify-center p-xl"><div class="spinner w-8 h-8"></div></div>';
      } else if (!total && !mem.adding) {
        // Empty state matching memory_redesign/code.html
        html += '<div class="bg-surface-container-low border border-outline-variant rounded-xl p-xl flex flex-col items-center justify-center text-center min-h-[300px]">';
        html += '<div class="w-16 h-16 bg-white border border-outline-variant rounded-2xl flex items-center justify-center mb-md shadow-sm">';
        html += '<span class="material-symbols-outlined text-primary text-3xl">edit_note</span>';
        html += '</div>';
        html += '<h3 class="font-headline-md text-headline-md text-on-surface mb-xs">No memories yet</h3>';
        html += '<div class="max-w-md bg-white border border-outline-variant rounded-lg p-md mt-base text-left shadow-sm">';
        html += '<div class="flex items-start gap-xs">';
        html += '<span class="font-mono-label text-mono-label bg-secondary-container text-on-secondary-container px-xs py-0.5 rounded uppercase mr-base">INFO</span>';
        html += '<p class="font-body-sm text-body-sm text-on-surface-variant">Chat with the AI and it will save facts about you <strong class="text-primary font-semibold">automatically</strong>, or add one manually using the button above.</p>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
      } else {
        // Memories list
        html += '<div class="space-y-sm">';
        mem.items.forEach(function(m) {
          var isEditing = mem.editingId === m.id;
          var borderStyle = isEditing ? 'border-primary shadow-md bg-white' : 'border-outline-variant bg-white hover:border-primary/50 shadow-sm';
          html += '<div class="border rounded-xl p-md space-y-sm transition-all ' + borderStyle + '">';
          
          if (isEditing) {
            html += '<textarea id="edit-memory-' + escapeAttr(m.id) + '" onchange="updateMemoryEditContent(this.value)" oninput="updateMemoryEditContent(this.value)" class="w-full bg-white border border-outline-variant rounded-lg p-md text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm min-h-[80px]" rows="2">' + escapeHtml(mem.editContent) + '</textarea>';
            html += '<div class="flex gap-sm pt-xs">';
            html += '<button onclick="saveEditMemory(\\'' + escapeAttr(m.id) + '\\')" class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-4 py-1.5 rounded-lg transition-all active:scale-95">Save</button>';
            html += '<button onclick="cancelEditMemory()" class="border border-outline text-on-surface-variant hover:bg-surface-container-high font-label-caps text-label-caps px-4 py-1.5 rounded-lg transition-all active:scale-95">Cancel</button>';
            html += '</div>';
          } else {
            html += '<div class="flex items-start justify-between gap-sm">';
            html += '<p class="font-body-md text-body-md text-on-surface leading-relaxed flex-grow whitespace-pre-wrap break-words">' + escapeHtml(m.content) + '</p>';
            html += '<div class="flex gap-xs items-center shrink-0">';
            html += '<button onclick="startEditMemory(\\'' + escapeAttr(m.id) + '\\')" class="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container-high text-on-surface-variant transition-colors" title="Edit"><span class="material-symbols-outlined text-[18px]">edit</span></button>';
            html += '<button onclick="deleteMemory(\\'' + escapeAttr(m.id) + '\\')" class="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container-high text-error transition-colors" title="Delete"><span class="material-symbols-outlined text-[18px]">close</span></button>';
            html += '</div>';
            html += '</div>';
            html += '<span class="font-mono-label text-mono-label text-on-surface-variant block mt-base">' + new Date(m.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + '</span>';
          }
          
          html += '</div>';
        });
        html += '</div>';
      }

      html += '</div></div>';
      return html;
    }

    // Render assistant message content: handles fenced code blocks with Run buttons
    // and collapsible tool-call disclosures for run_code outputs.
    function renderMessageContent(msg) {
      var content = msg.content || '';
      var toolOutputs = msg.toolOutputs || [];
      var html = '';

      // Split on fenced code blocks (triple-backtick lang newline code triple-backtick)
      var codeRe = /\`\`\`(\w*)\\n?([\s\S]*?)\`\`\`/g;
      var lastIndex = 0;
      var match;
      while ((match = codeRe.exec(content)) !== null) {
        // Text before this block
        if (match.index > lastIndex) {
          html += '<span style="white-space:pre-wrap;word-break:break-word">' + escapeHtml(content.slice(lastIndex, match.index)) + '</span>';
        }
        // Store code under a unique ID so we avoid injecting it into onclick attributes
        var blockId = 'cb_' + Math.random().toString(36).slice(2, 10);
        state.chat.codeBlocks[blockId] = match[2];
        var lang = match[1] || 'js';
        html += '<div style="margin:6px 0;border-radius:8px;overflow:hidden;border:1px solid rgba(0,0,0,0.12)">';
        html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;background:rgba(0,0,0,0.06);font-size:11px;color:var(--muted)">';
        html += '<span style="font-family:JetBrains Mono,monospace">' + escapeHtml(lang) + '</span>';
        html += '<button class="btn btn-sm" onclick="runCodeBlock(this,\\'' + blockId + '\\')" style="padding:3px 10px;font-size:11px;background:var(--primary);color:#fff;border:none">&#9654; Run</button>';
        html += '</div>';
        html += '<pre style="margin:0;padding:10px;background:rgba(0,0,0,0.03);overflow-x:auto;font-family:JetBrains Mono,monospace;font-size:12px;line-height:1.5"><code>' + escapeHtml(match[2]) + '</code></pre>';
        html += '<div class="code-output-slot" style="display:none"></div>';
        html += '</div>';
        lastIndex = codeRe.lastIndex;
      }
      // Remaining text after last code block
      if (lastIndex < content.length) {
        html += '<span style="white-space:pre-wrap;word-break:break-word">' + escapeHtml(content.slice(lastIndex)) + '</span>';
      }

      // Collapsed disclosures for run_code tool calls
      toolOutputs.forEach(function(to) {
        if (to.name !== 'run_code') return;
        var parsed = null;
        try { parsed = JSON.parse(to.output); } catch(_) {}
        var output = parsed ? (parsed.output || '(no output)') : to.output;
        var hasError = parsed && parsed.error;
        var durationMs = parsed && parsed.duration_ms ? parsed.duration_ms + 'ms' : '';
        var code = to.input && to.input.code ? String(to.input.code) : '';
        html += '<details style="margin-top:6px">';
        html += '<summary style="cursor:pointer;font-size:11px;color:var(--muted);padding:3px 0;list-style:none;display:flex;align-items:center;gap:4px">';
        html += '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
        html += 'Code ran' + (durationMs ? ' &middot; ' + durationMs : '') + (hasError ? ' &middot; error' : '') + '</summary>';
        if (code) {
          html += '<pre style="margin:4px 0 0;padding:8px;background:rgba(0,0,0,0.06);border-radius:6px 6px 0 0;overflow-x:auto;font-family:JetBrains Mono,monospace;font-size:12px;line-height:1.5;color:var(--fg)">' + escapeHtml(code) + '</pre>';
          html += '<pre style="margin:0;padding:8px;background:rgba(0,0,0,0.03);border-radius:0 0 6px 6px;border-top:1px solid rgba(0,0,0,0.08);overflow-x:auto;font-family:JetBrains Mono,monospace;font-size:12px;line-height:1.5;color:' + (hasError ? 'var(--destructive)' : 'var(--muted)') + '">' + escapeHtml(output + (hasError ? '\\n[error] ' + parsed.error : '')) + '</pre>';
        } else {
          html += '<pre style="margin:4px 0 0;padding:8px;background:rgba(0,0,0,0.04);border-radius:6px;overflow-x:auto;font-family:JetBrains Mono,monospace;font-size:12px;line-height:1.5;color:' + (hasError ? 'var(--destructive)' : 'var(--fg)') + '">' + escapeHtml(output + (hasError ? '\\n[error] ' + parsed.error : '')) + '</pre>';
        }
        html += '</details>';
      });

      return html;
    }

    async function runCodeBlock(btn, blockId) {
      var code = state.chat.codeBlocks[blockId];
      if (!code) return;
      // The output slot is the next sibling div after the <pre>
      var wrapper = btn.closest('[style*="border-radius:8px"]');
      var slot = wrapper ? wrapper.querySelector('.code-output-slot') : null;
      if (!slot) return;

      btn.disabled = true;
      btn.textContent = '...';
      slot.style.display = 'block';
      slot.innerHTML = '<div style="padding:6px 10px;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px"><span class="spinner" style="display:inline-block;width:10px;height:10px;border-width:1.5px;vertical-align:middle"></span>Running...</div>';

      try {
        var res = await fetch('/api/code/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: code }),
        });
        var d = await res.json();
        if (d.ok) {
          var out = d.output || '(no output)';
          if (d.error) out += '\\n[error] ' + d.error;
          slot.innerHTML = '<pre style="margin:0;padding:8px 10px;border-top:1px solid rgba(0,0,0,0.08);font-family:JetBrains Mono,monospace;font-size:12px;line-height:1.5;overflow-x:auto;color:' + (d.error ? 'var(--destructive)' : 'var(--fg)') + ';white-space:pre-wrap;word-break:break-word">' + escapeHtml(out) + '</pre>';
        } else {
          slot.innerHTML = '<div style="padding:8px 10px;font-size:12px;color:var(--destructive);border-top:1px solid rgba(0,0,0,0.08)">Error: ' + escapeHtml(d.error || 'Unknown error') + '</div>';
        }
      } catch(e) {
        slot.innerHTML = '<div style="padding:8px 10px;font-size:12px;color:var(--destructive);border-top:1px solid rgba(0,0,0,0.08)">Network error: ' + escapeHtml(e.message) + '</div>';
      }
      btn.disabled = false;
      btn.textContent = 'Run';
    }
    window.runCodeBlock = runCodeBlock;

    function renderAiTab() {
      var chat = state.chat;
      if (!chat.aiAvailable) {
        return '<div class="flex-grow flex flex-col items-center justify-center p-xl text-center max-w-md mx-auto">' +
          '<div class="w-20 h-20 bg-surface-container-low rounded-xl flex items-center justify-center mb-md border border-outline-variant">' +
          '<span class="material-symbols-outlined text-primary text-4xl">smart_toy</span>' +
          '</div>' +
          '<h3 class="font-headline-md text-headline-md text-on-surface mb-xs">AI Assistant not configured</h3>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant mb-lg">Add an API key in Settings to get started.</p>' +
          '<button class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-6 py-2.5 rounded-xl transition-all active:scale-95 shadow-sm" onclick="switchTab(\\'settings\\')">Go to Settings</button>' +
          '</div>';
      }

      // Build pending SMS staged actions for this chat session
      var smsPending = state.staging.filter(function(a) {
        return a.source === 'sms' && a.status === 'pending';
      });

      var messagesHtml = '';
      if (!chat.messages.length) {
        messagesHtml = '<div class="flex-grow flex flex-col items-center justify-center max-w-2xl mx-auto text-center px-margin py-xl">' +
          '<div class="w-20 h-20 bg-surface-container-low rounded-xl flex items-center justify-center mb-md border border-outline-variant">' +
          '<span class="material-symbols-outlined text-primary text-4xl">database</span>' +
          '</div>' +
          '<h2 class="font-headline-md text-headline-md text-on-surface mb-xs">How can I help with your data?</h2>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant max-w-sm">Ask me anything about your data — emails, calendar, GitHub, or SMS.</p>' +
          '<div class="grid grid-cols-2 gap-sm mt-xl w-full max-w-md">' +
          '<button onclick="injectDemoQuestion(\\'Summarize my unread emails from the last 24h\\')" class="flex flex-col items-start p-md bg-white border border-outline-variant rounded-lg hover:border-primary transition-colors text-left group shadow-sm">' +
          '<span class="material-symbols-outlined text-primary mb-base">mail</span>' +
          '<span class="font-label-sm text-label-sm text-on-surface font-semibold">Summarize emails</span>' +
          '<span class="font-body-sm text-body-sm text-on-surface-variant opacity-60 group-hover:opacity-100 transition-opacity">Last 24 hours</span>' +
          '</button>' +
          '<button onclick="injectDemoQuestion(\\'What is my schedule for today and tomorrow?\\')" class="flex flex-col items-start p-md bg-white border border-outline-variant rounded-lg hover:border-primary transition-colors text-left group shadow-sm">' +
          '<span class="material-symbols-outlined text-primary mb-base">calendar_month</span>' +
          '<span class="font-label-sm text-label-sm text-on-surface font-semibold">Check schedule</span>' +
          '<span class="font-body-sm text-body-sm text-on-surface-variant opacity-60 group-hover:opacity-100 transition-opacity">Upcoming events</span>' +
          '</button>' +
          '<button onclick="injectDemoQuestion(\\'List open pull requests in my repositories\\')" class="flex flex-col items-start p-md bg-white border border-outline-variant rounded-lg hover:border-primary transition-colors text-left group shadow-sm">' +
          '<span class="material-symbols-outlined text-primary mb-base">code</span>' +
          '<span class="font-label-sm text-label-sm text-on-surface font-semibold">GitHub PRs</span>' +
          '<span class="font-body-sm text-body-sm text-on-surface-variant opacity-60 group-hover:opacity-100 transition-opacity">Review status</span>' +
          '</button>' +
          '<button onclick="injectDemoQuestion(\\'Find my recent 2FA codes from SMS\\')" class="flex flex-col items-start p-md bg-white border border-outline-variant rounded-lg hover:border-primary transition-colors text-left group shadow-sm">' +
          '<span class="material-symbols-outlined text-primary mb-base">sms</span>' +
          '<span class="font-label-sm text-label-sm text-on-surface font-semibold">Find SMS codes</span>' +
          '<span class="font-body-sm text-body-sm text-on-surface-variant opacity-60 group-hover:opacity-100 transition-opacity">Recent 2FA</span>' +
          '</button>' +
          '</div>' +
          '</div>';
      } else {
        messagesHtml += '<div class="space-y-md">';
        chat.messages.forEach(function(msg) {
          var isUser = msg.role === 'user';
          var bubbleContent = isUser
            ? '<span class="whitespace-pre-wrap break-words">' + escapeHtml(msg.content) + '</span>'
            : renderMessageContent(msg);
          messagesHtml += '<div class="flex ' + (isUser ? 'justify-end' : 'justify-start') + '">' +
            '<div class="' + (isUser ? 'bg-primary text-on-primary rounded-2xl rounded-tr-sm' : 'bg-white border border-outline-variant text-on-background rounded-2xl rounded-tl-sm') + ' px-4 py-2.5 max-w-[85%] shadow-sm font-body-sm text-body-sm leading-relaxed">' +
            bubbleContent + '</div></div>';
        });
        messagesHtml += '</div>';
      }

      var smsPendingHtml = '';
      if (smsPending.length) {
        smsPendingHtml += '<div class="space-y-sm mt-md">';
        smsPending.forEach(function(a) {
          var data = typeof a.action_data === 'string' ? JSON.parse(a.action_data) : a.action_data;
          var safeId = a.action_id.replace(/'/g, "\\\\'");
          var safeTo = (data.to || '').replace(/'/g, "\\\\'");
          var safeBody = (data.body || '').replace(/'/g, "\\\\'");
          smsPendingHtml += '<div class="bg-white border border-outline-variant rounded-xl p-md shadow-sm max-w-[85%] space-y-sm">' +
            '<div class="font-mono-label text-mono-label text-on-surface-variant uppercase tracking-wider">Staged SMS</div>' +
            '<div class="font-body-sm text-body-sm text-on-surface"><strong>To:</strong> ' + escapeHtml(data.to || '') + '</div>' +
            '<div class="font-body-sm text-body-sm text-on-surface-variant whitespace-pre-wrap">' + escapeHtml(data.body || '') + '</div>' +
            '<div class="flex gap-sm">' +
            '<button class="border border-error/30 text-error hover:bg-error-container/20 px-4 py-1.5 rounded-lg font-label-caps text-label-caps transition-all active:scale-95" onclick="rejectSmsAction(\\'' + safeId + '\\')">Deny</button>' +
            '<button class="bg-primary hover:bg-primary-hover text-on-primary px-4 py-1.5 rounded-lg font-label-caps text-label-caps transition-all active:scale-95 shadow-sm" onclick="sendSmsAction(\\'' + safeId + '\\',\\'' + safeTo + '\\',\\'' + safeBody + '\\')">Send SMS</button>' +
            '</div></div>';
        });
        smsPendingHtml += '</div>';
      }

      var loadingHtml = chat.loading
        ? '<div class="flex items-center gap-xs text-on-surface-variant/70 font-body-sm text-body-sm py-xs"><div class="spinner w-4 h-4 shrink-0"></div>Thinking…</div>'
        : '';
      var errorHtml = chat.error
        ? '<div class="p-md bg-error-container text-on-error-container border border-error/20 rounded-xl font-body-sm text-body-sm shadow-sm mt-md">' + escapeHtml(chat.error) + '</div>'
        : '';

      var mainLayout = '<div class="flex flex-col h-full bg-background">';
      mainLayout += '  <header class="flex justify-between items-center px-margin h-16 border-b border-outline-variant bg-surface shrink-0">';
      mainLayout += '    <div class="flex items-center gap-sm">';
      mainLayout += '      <span class="material-symbols-outlined text-primary">smart_toy</span>';
      mainLayout += '      <h1 class="font-headline-md text-headline-md font-bold text-primary">AI Studio</h1>';
      mainLayout += '    </div>';
      mainLayout += '    <button class="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors" onclick="clearChat()" title="Clear conversation">';
      mainLayout += '      <span class="material-symbols-outlined text-[20px]">delete</span>';
      mainLayout += '    </button>';
      mainLayout += '  </header>';
      mainLayout += '  <div id="chat-messages" class="flex-grow overflow-y-auto px-margin py-md flex flex-col justify-between">';
      mainLayout += '    <div class="flex-grow flex flex-col justify-center min-h-[70%]">';
      mainLayout += '      ' + messagesHtml;
      mainLayout += '    </div>';
      mainLayout += '    <div class="shrink-0 space-y-sm">';
      mainLayout += '      ' + smsPendingHtml;
      mainLayout += '      ' + loadingHtml;
      mainLayout += '      ' + errorHtml;
      mainLayout += '    </div>';
      mainLayout += '  </div>';
      mainLayout += '  <div class="p-margin border-t border-outline-variant bg-surface shrink-0">';
      mainLayout += '    <div class="max-w-3xl mx-auto flex gap-xs items-center bg-surface-container-low border border-outline-variant rounded-xl p-xs shadow-sm">';
      mainLayout += '      <button id="voice-btn" title="Voice input" onclick="toggleVoiceInput()" class="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors">';
      mainLayout += '        <span class="material-symbols-outlined">mic</span>';
      mainLayout += '      </button>';
      mainLayout += '      <input id="chat-input" type="text" placeholder="Ask about your data..." class="flex-grow bg-transparent border-none focus:ring-0 font-body-md text-body-md text-on-surface placeholder:text-on-surface-variant/60" onkeydown="if(event.key===\\'Enter\\'&&!event.shiftKey){event.preventDefault();sendChatMessage();}" ' + (chat.loading ? 'disabled' : '') + ' />';
      mainLayout += '      <button onclick="sendChatMessage()" ' + (chat.loading ? 'disabled' : '') + ' class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-lg py-sm rounded-lg transition-all active:scale-95 flex items-center gap-xs shadow-md shrink-0">';
      mainLayout += '        <span>Send</span>';
      mainLayout += '        <span class="material-symbols-outlined text-sm">send</span>';
      mainLayout += '      </button>';
      mainLayout += '    </div>';
      mainLayout += '  </div>';
      mainLayout += '</div>';
      return mainLayout;
    }

    var _voiceRecognition = null;
    function toggleVoiceInput() {
      var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) { alert('Voice input is not supported in this browser.'); return; }
      if (_voiceRecognition) {
        _voiceRecognition.stop();
        _voiceRecognition = null;
        var btn = document.getElementById('voice-btn');
        if (btn) btn.style.color = 'var(--muted)';
        return;
      }
      var rec = new SpeechRecognition();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      _voiceRecognition = rec;
      var btn = document.getElementById('voice-btn');
      if (btn) btn.style.color = 'var(--primary)';
      rec.onresult = function(e) {
        var transcript = e.results[0][0].transcript;
        var input = document.getElementById('chat-input');
        if (input) { input.value = (input.value ? input.value + ' ' : '') + transcript; input.focus(); }
        _voiceRecognition = null;
        if (btn) btn.style.color = 'var(--muted)';
      };
      rec.onerror = function() { _voiceRecognition = null; if (btn) btn.style.color = 'var(--muted)'; };
      rec.onend = function() { _voiceRecognition = null; if (btn) btn.style.color = 'var(--muted)'; };
      rec.start();
    }
    window.toggleVoiceInput = toggleVoiceInput;

    async function sendChatMessage() {
      var input = document.getElementById('chat-input');
      if (!input) return;
      var text = input.value.trim();
      if (!text || state.chat.loading) return;
      input.value = '';

      state.chat.messages.push({ role: 'user', content: text });
      state.chat.loading = true;
      state.chat.error = null;
      if (currentTab === 'ai') render();

      var msgs = state.chat.messages.slice(-50);
      var sms = state.sms.messages;

      try {
        var res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: msgs, sms: sms }),
        });
        var data = await res.json();
        state.chat.loading = false;
        if (data.ok) {
          state.chat.messages.push({ role: 'assistant', content: data.reply, toolOutputs: data.toolOutputs || [] });
          if (data.stagedActionIds && data.stagedActionIds.length) {
            state.chat.stagedSmsIds = state.chat.stagedSmsIds.concat(data.stagedActionIds);
            await fetchData();
          }
        } else {
          state.chat.error = data.error || 'Unknown error';
        }
      } catch (err) {
        state.chat.loading = false;
        state.chat.error = err.message || 'Network error';
      }
      if (currentTab === 'ai') {
        render();
        var msgs2 = document.getElementById('chat-messages');
        if (msgs2) msgs2.scrollTop = msgs2.scrollHeight;
      }
    }
    window.sendChatMessage = sendChatMessage;

    function clearChat() {
      state.chat.messages = [];
      state.chat.error = null;
      state.chat.stagedSmsIds = [];
      state.chat.codeBlocks = {};
      if (currentTab === 'ai') render();
    }
    window.clearChat = clearChat;

    function selectProvider(val) {
      state.settingsProvider = val;
      var customUrls = { anthropic: 'https://api.anthropic.com/v1', openai: '', groq: 'https://api.groq.com/openai/v1', google: 'https://generativelanguage.googleapis.com/v1beta/openai/', ollama: 'http://localhost:11434/v1' };
      var defaultModels = { anthropic: 'claude-sonnet-4-6', openai: 'gpt-4o', groq: 'llama-3.3-70b-versatile', google: 'gemini-2.0-flash', ollama: 'llama3' };
      var urlEl = document.getElementById('ai-base-url');
      var modelEl = document.getElementById('ai-model');
      if (urlEl) urlEl.placeholder = customUrls[val] || 'https://...';
      if (modelEl && !modelEl.value) modelEl.placeholder = defaultModels[val] || 'model name';
      // Re-render just the provider pills without clobbering focused inputs
      var pillsEl = document.getElementById('provider-pills');
      if (pillsEl) pillsEl.innerHTML = renderProviderPills();
    }
    window.selectProvider = selectProvider;

    function renderProviderPills() {
      var providers = [
        { value: 'anthropic', label: 'Anthropic' },
        { value: 'openai', label: 'OpenAI' },
        { value: 'groq', label: 'Groq' },
        { value: 'google', label: 'Google' },
        { value: 'ollama', label: 'Ollama' },
      ];
      return providers.map(function(p) {
        var sel = state.settingsProvider === p.value;
        var btnClass = sel 
          ? 'bg-primary text-on-primary font-semibold shadow-sm'
          : 'bg-white text-on-surface-variant hover:bg-surface-container-high border border-outline-variant transition-colors';
        return '<button onclick="selectProvider(\\'' + p.value + '\\')" class="px-4 py-1.5 rounded-full font-label-sm text-label-sm font-semibold shadow-sm ' + btnClass + '">' + p.label + '</button>';
      }).join('');
    }

    function saveAiKey() {
      var key = document.getElementById('ai-api-key').value.trim();
      var model = document.getElementById('ai-model').value.trim();
      var provider = state.settingsProvider;
      var baseUrl = document.getElementById('ai-base-url').value.trim();
      if (!key) { alert('API key is required'); return; }
      fetch('/api/settings/ai-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key, model: model || undefined, provider: provider || 'anthropic', base_url: baseUrl || undefined }),
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) {
          state.chat.aiAvailable = true;
          var flash = document.getElementById('ai-flash');
          if (flash) { flash.style.opacity = '1'; setTimeout(function() { flash.style.opacity = '0'; }, 2000); }
        } else {
          alert('Error: ' + (d.error || 'Unknown error'));
        }
      }).catch(function() { alert('Network error'); });
    }
    window.saveAiKey = saveAiKey;

    async function setAutoReply(enabled) {
      if (state.autoReply.loading) return;
      state.autoReply.loading = true;
      render();
      try {
        var res = await fetch('/api/settings/auto-reply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: enabled })
        });
        var d = await res.json();
        if (d.ok) {
          state.autoReply.enabled = d.enabled;
          // Request RECEIVE_SMS permission when enabling on Android
          if (enabled && window.AndroidSms) {
            var reqId = 'rcvsms_' + Date.now();
            window.AndroidSms.getMessages(reqId, 'inbox', 1); // triggers permission request for SMS group
          }
        }
      } catch(e) { /* non-fatal */ }
      state.autoReply.loading = false;
      render();
    }
    window.setAutoReply = setAutoReply;

    async function saveMaxToolRounds(value) {
      var n = parseInt(value, 10);
      if (isNaN(n) || n < 1 || n > 10) return;
      state.autoReply.maxToolRounds = n;
      try {
        await fetch('/api/settings/auto-reply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: state.autoReply.enabled, maxToolRounds: n })
        });
      } catch(e) { /* non-fatal */ }
    }
    window.saveMaxToolRounds = saveMaxToolRounds;

    async function testAutoReply() {
      if (state.autoReply.testLoading) return;
      state.autoReply.testLoading = true;
      state.autoReply.testResult = null;
      render();
      try {
        var fakeFrom = '+1555' + Math.floor(1000000 + Math.random() * 9000000);
        var res = await fetch('/sms/auto-reply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: fakeFrom, body: 'Hey, are you free later?' })
        });
        var d = await res.json();
        if (!d.ok) {
          state.autoReply.testResult = { ok: false, msg: d.error || 'Server error' };
        } else if (!d.enabled) {
          state.autoReply.testResult = { ok: false, msg: 'Toggle is OFF — enable it above first' };
        } else if (d.skipped) {
          state.autoReply.testResult = { ok: false, msg: 'Skipped: ' + (d.reason || 'unknown reason') };
        } else if (d.reply) {
          state.autoReply.testResult = { ok: true, msg: 'AI replied: "' + d.reply + '"' };
        } else {
          state.autoReply.testResult = { ok: false, msg: 'No reply generated' };
        }
      } catch(e) {
        state.autoReply.testResult = { ok: false, msg: 'Network error: ' + (e.message || e) };
      }
      state.autoReply.testLoading = false;
      render();
    }
    window.testAutoReply = testAutoReply;

    function toggleAiBaseUrl() { /* kept for compatibility; logic moved to selectProvider */ }
    window.toggleAiBaseUrl = toggleAiBaseUrl;

    var SKILL_TRIGGERS = [
      { key: 'sms_received', label: 'SMS Received' },
    ];

    function renderLogicalEditor(id, logicTree) {
      var isAdding = id === 'new';
      var html = '<div class="flex flex-col gap-sm mt-xs">';
      
      (logicTree || []).forEach(function(node, index) {
        var nodeId = escapeAttr(node.id || '');
        var type = node.type || 'ELIF';
        var condition = node.condition || '';
        var action = node.action || '';
        
        var isElse = type === 'ELSE';
        var isContext = type === 'CONTEXT';
        var cardBorder = isElse ? 'border-2 border-primary-container/30' : 'border border-outline-variant';
        
        html += '<div class="bg-white rounded-xl ' + cardBorder + ' logic-card-shadow p-sm space-y-sm relative group">';
        
        // Remove button
        if ((logicTree || []).length > 1) {
          html += '<button onclick="removeLogicNode(\\'' + id + '\\',' + index + ')" class="absolute top-2 right-2 text-error opacity-40 group-hover:opacity-100 transition-opacity">' +
            '<span class="material-symbols-outlined text-[18px]">close</span>' +
            '</button>';
        }
        
        // Header row
        html += '<div class="flex items-center gap-xs flex-wrap">';
        // Type select
        html += '<div class="bg-surface-container-high rounded px-2 py-1 flex items-center gap-1">';
        html += '<select onchange="updateLogicNodeType(\\'' + id + '\\',' + index + ',this.value)" class="text-label-sm font-label-sm font-bold text-on-surface bg-transparent border-none p-0 focus:ring-0 cursor-pointer">';
        html += '<option value="IF"' + (type === 'IF' ? ' selected' : '') + '>IF</option>';
        html += '<option value="ELIF"' + (type === 'ELIF' ? ' selected' : '') + '>ELIF</option>';
        html += '<option value="ELSE"' + (type === 'ELSE' ? ' selected' : '') + '>ELSE</option>';
        html += '<option value="CONTEXT"' + (type === 'CONTEXT' ? ' selected' : '') + '>CONTEXT</option>';
        html += '</select>';
        html += '</div>';
        
        // Condition Input (hidden if ELSE or CONTEXT)
        if (isElse) {
          html += '<div class="flex-grow italic text-on-surface-variant text-body-sm font-body-sm">otherwise</div>';
        } else if (isContext) {
          html += '<div class="flex-grow italic text-on-surface-variant text-body-sm font-body-sm">background context</div>';
        } else {
          html += '<div class="flex-grow border-b border-outline-variant pb-base">';
          html += '<input type="text" value="' + escapeAttr(condition) + '" oninput="updateLogicNodeCondition(\\'' + id + '\\',' + index + ',this.value)" onblur="performSkillAutoSave(\\'' + id + '\\')" placeholder="e.g., user asks for pricing" class="w-full border-none focus:ring-0 p-0 text-body-sm font-body-sm italic text-on-surface bg-transparent">';
          html += '</div>';
        }
        
        html += '<span class="text-mono-label font-mono-label text-on-surface-variant">' + (isContext ? 'INFO' : 'THEN') + '</span>';
        html += '</div>';
        
        // Action Input
        var actionPlaceholder = isContext ? 'e.g., check all calendars for conflicts' : 'e.g., send pricing PDF';
        html += '<div class="bg-surface-container-lowest border border-outline-variant rounded-lg p-2 shadow-sm">';
        html += '<textarea oninput="updateLogicNodeAction(\\'' + id + '\\',' + index + ',this.value)" onblur="performSkillAutoSave(\\'' + id + '\\')" placeholder="' + actionPlaceholder + '" class="w-full border-none focus:ring-0 p-0 text-body-sm font-body-sm text-on-surface bg-transparent resize-none" rows="1">' + escapeHtml(action) + '</textarea>';
        html += '</div>';
        
        html += '</div>';
      });
      
      // Add Node Button
      html += '<div class="flex justify-start pt-base">';
      html += '<button onclick="addLogicNode(\\'' + id + '\\')" class="w-full py-2 border-2 border-dashed border-outline-variant rounded-xl text-on-surface-variant font-label-sm text-label-sm hover:border-primary hover:text-primary transition-all flex items-center justify-center gap-1">';
      html += '<span class="material-symbols-outlined text-[18px]">add</span>';
      html += '<span>Add Logic Step</span>';
      html += '</button>';
      html += '</div>';
      
      html += '</div>';
      return html;
    }
    window.renderLogicalEditor = renderLogicalEditor;

    async function toggleEditSkillView(id) {
      var sk = state.skills;
      var isAdding = id === 'new';
      var editContent = isAdding ? {
        name: sk.newName,
        instructions: sk.newInstructions,
        trigger_event: sk.newTrigger,
        current_view: sk.newCurrentView,
        logic_tree: sk.newLogicTree
      } : sk.editContent;

      var currentView = editContent.current_view || 'SUMMARIZED';
      var cache = sk.translationCache || {};

      if (currentView === 'LOGICAL') {
        var currentTreeJson = JSON.stringify(editContent.logic_tree);
        if (cache.logicTreeJson === currentTreeJson && cache.instructions !== undefined) {
          editContent.current_view = 'SUMMARIZED';
          editContent.instructions = cache.instructions;
          if (isAdding) {
            sk.newCurrentView = 'SUMMARIZED';
            sk.newInstructions = cache.instructions;
          }
          render();
          return;
        }
      } else {
        if (cache.instructions === editContent.instructions && cache.logicTreeJson !== undefined) {
          editContent.current_view = 'LOGICAL';
          editContent.logic_tree = JSON.parse(cache.logicTreeJson);
          if (isAdding) {
            sk.newCurrentView = 'LOGICAL';
            sk.newLogicTree = JSON.parse(cache.logicTreeJson);
          }
          render();
          return;
        }
      }

      sk.isTranslating[id] = true;
      render();

      try {
        if (currentView === 'LOGICAL') {
          // Flow A: Logical -> Summarized
          var r = await fetch('/api/skills/translate/logical-to-summarized', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ logicTree: editContent.logic_tree })
          });
          var d = await r.json();
          if (d.ok) {
            editContent.instructions = d.nlSummary;
            editContent.current_view = 'SUMMARIZED';
            sk.translationCache = {
              instructions: d.nlSummary,
              logicTreeJson: JSON.stringify(editContent.logic_tree)
            };
          } else {
            alert(d.error || 'Failed to translate logic to text');
          }
        } else {
          // Flow B: Summarized -> Logical
          var r = await fetch('/api/skills/translate/summarized-to-logical', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nlSummary: editContent.instructions })
          });
          var d = await r.json();
          if (d.ok) {
            editContent.logic_tree = d.logicTree;
            editContent.current_view = 'LOGICAL';
            sk.translationCache = {
              instructions: editContent.instructions,
              logicTreeJson: JSON.stringify(d.logicTree)
            };
          } else {
            alert(d.error || 'Could not parse logic from text');
          }
        }
      } catch (e) {
        alert('Translation error: ' + e.message);
      } finally {
        sk.isTranslating[id] = false;
        if (isAdding) {
          sk.newInstructions = editContent.instructions;
          sk.newCurrentView = editContent.current_view;
          sk.newLogicTree = editContent.logic_tree;
        }
        render();
      }
    }
    window.toggleEditSkillView = toggleEditSkillView;

    function updateLogicNodeType(id, index, type) {
      var sk = state.skills;
      var isAdding = id === 'new';
      var logicTree = isAdding ? sk.newLogicTree : sk.editContent.logic_tree;
      
      if (logicTree[index]) {
        logicTree[index].type = type;
        if (type === 'ELSE' || type === 'CONTEXT') {
          logicTree[index].condition = null;
          if (type === 'ELSE' && logicTree.length > index + 1) {
            logicTree.splice(index + 1);
          }
        } else {
          if (logicTree[index].condition === null) {
            logicTree[index].condition = '';
          }
        }
      }
      triggerSkillAutoSave(id);
      render();
    }
    window.updateLogicNodeType = updateLogicNodeType;

    function updateLogicNodeCondition(id, index, val) {
      var sk = state.skills;
      var isAdding = id === 'new';
      var logicTree = isAdding ? sk.newLogicTree : sk.editContent.logic_tree;
      if (logicTree[index]) {
        logicTree[index].condition = val;
      }
      triggerSkillAutoSave(id);
    }
    window.updateLogicNodeCondition = updateLogicNodeCondition;

    function updateLogicNodeAction(id, index, val) {
      var sk = state.skills;
      var isAdding = id === 'new';
      var logicTree = isAdding ? sk.newLogicTree : sk.editContent.logic_tree;
      if (logicTree[index]) {
        logicTree[index].action = val;
      }
      triggerSkillAutoSave(id);
    }
    window.updateLogicNodeAction = updateLogicNodeAction;

    function addLogicNode(id) {
      var sk = state.skills;
      var isAdding = id === 'new';
      var logicTree = isAdding ? sk.newLogicTree : sk.editContent.logic_tree;
      var lastNode = logicTree[logicTree.length - 1];
      var newNodeId = 'node_' + Math.random().toString(36).slice(2, 9);
      
      if (lastNode && lastNode.type === 'ELSE') {
        logicTree.splice(logicTree.length - 1, 0, {
          id: newNodeId,
          type: 'ELIF',
          condition: '',
          action: ''
        });
      } else {
        logicTree.push({
          id: newNodeId,
          type: 'ELIF',
          condition: '',
          action: ''
        });
      }
      triggerSkillAutoSave(id);
      render();
    }
    window.addLogicNode = addLogicNode;

    function removeLogicNode(id, index) {
      var sk = state.skills;
      var isAdding = id === 'new';
      var logicTree = isAdding ? sk.newLogicTree : sk.editContent.logic_tree;
      
      if (logicTree.length > 1) {
        logicTree.splice(index, 1);
        if (logicTree[0]) {
          logicTree[0].type = 'IF';
          if (logicTree[0].condition === null) {
            logicTree[0].condition = '';
          }
        }
      }
      triggerSkillAutoSave(id);
      render();
    }
    window.removeLogicNode = removeLogicNode;

    var _skillSaveTimer = null;
    function triggerSkillAutoSave(id) {
      if (id === 'new') return;
      clearTimeout(_skillSaveTimer);
      _skillSaveTimer = setTimeout(function() {
        performSkillAutoSave(id);
      }, 1000);
    }
    window.triggerSkillAutoSave = triggerSkillAutoSave;

    async function performSkillAutoSave(id) {
      if (id === 'new') return;
      var sk = state.skills;
      if (sk.editingId !== id) return;
      var c = sk.editContent;
      try {
        await fetch('/api/skills/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: c.name,
            instructions: c.instructions,
            trigger_event: c.trigger_event,
            current_view: c.current_view,
            logic_tree: JSON.stringify(c.logic_tree)
          })
        });
      } catch(e) { console.warn('Auto-save failed:', e); }
    }
    window.performSkillAutoSave = performSkillAutoSave;

    function renderSkillCard(s) {
      var sk = state.skills;
      var isEditing = sk.editingId === s.id;
      var safeId = escapeAttr(s.id);
      var isActive = !!s.enabled;
      var isTranslating = !!sk.isTranslating[s.id];
      var borderStyle = isEditing ? 'border-primary shadow-md' : isActive ? 'border-primary/50 hover:border-primary shadow-sm bg-white' : 'border-outline-variant hover:border-primary/30 shadow-sm bg-white';
      var html = '<div data-skill-id="' + safeId + '" class="border rounded-xl p-md transition-all relative ' + borderStyle + '">';
      
      if (isTranslating) {
        html += '<div class="absolute inset-0 bg-white/70 z-10 flex flex-col items-center justify-center rounded-xl gap-sm">';
        html += '<div class="spinner w-6 h-6"></div>';
        html += '<span class="font-label-sm text-label-sm font-bold text-on-surface">Translating...</span>';
        html += '</div>';
      }

      if (isEditing) {
        var triggerOptions = SKILL_TRIGGERS.map(function(t) {
          return '<option value="' + t.key + '"' + (sk.editContent.trigger_event === t.key ? ' selected' : '') + '>' + t.label + '</option>';
        }).join('');
        
        var currentView = sk.editContent.current_view || 'SUMMARIZED';

        html += '<div class="flex items-center justify-between gap-sm mb-sm">';
        html += '<span class="font-label-caps text-label-caps text-on-surface-variant">Editing Skill</span>';
        html += '<div class="flex border border-outline-variant rounded-lg overflow-hidden bg-surface-container-low p-0.5">';
        html += '<button onclick="toggleEditSkillView(\\'' + safeId + '\\')" class="font-label-sm text-label-sm px-3 py-1 rounded-md transition-colors ' + (currentView === 'LOGICAL' ? 'bg-primary text-on-primary font-semibold shadow-sm' : 'text-on-surface-variant hover:text-on-surface') + '">Logical</button>';
        html += '<button onclick="toggleEditSkillView(\\'' + safeId + '\\')" class="font-label-sm text-label-sm px-3 py-1 rounded-md transition-colors ' + (currentView === 'SUMMARIZED' ? 'bg-primary text-on-primary font-semibold shadow-sm' : 'text-on-surface-variant hover:text-on-surface') + '">Summarized</button>';
        html += '</div>';
        html += '</div>';

        html += '<div class="space-y-sm">';
        html += '<div class="flex gap-sm">';
        html += '<input id="edit-skill-name-' + safeId + '" value="' + escapeAttr(sk.editContent.name) + '" oninput="state.skills.editContent.name=this.value; triggerSkillAutoSave(\\'' + safeId + '\\')" onblur="performSkillAutoSave(\\'' + safeId + '\\')" placeholder="Skill name" class="flex-grow bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">';
        html += '<select id="edit-skill-trigger-' + safeId + '" onchange="state.skills.editContent.trigger_event=this.value; triggerSkillAutoSave(\\'' + safeId + '\\'); render()" class="bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">' + triggerOptions + '</select>';
        html += '</div>';
        
        if (currentView === 'LOGICAL') {
          html += renderLogicalEditor(s.id, sk.editContent.logic_tree);
        } else {
          html += '<textarea id="edit-skill-instructions-' + safeId + '" oninput="state.skills.editContent.instructions=this.value; triggerSkillAutoSave(\\'' + safeId + '\\')" onblur="performSkillAutoSave(\\'' + safeId + '\\')" placeholder="Describe what the AI should do when this trigger fires…" class="w-full bg-white border border-outline-variant rounded-lg p-md text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm min-h-[120px]" rows="4">' + escapeHtml(sk.editContent.instructions) + '</textarea>';
        }
        
        html += '</div><div class="flex gap-sm mt-md">';
        html += '<button onclick="saveEditSkill(\\'' + safeId + '\\')" class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-6 py-2 rounded-xl transition-all active:scale-95 shadow-sm">Save</button>';
        html += '<button onclick="cancelEditSkill()" class="border border-outline text-on-surface-variant hover:bg-surface-container-high font-label-caps text-label-caps px-6 py-2 rounded-xl transition-all active:scale-95">Cancel</button>';
        html += '</div>';
      } else {
        html += '<div class="flex items-start justify-between gap-sm mb-xs">';
        html += '<div class="flex items-center gap-xs flex-wrap">';
        html += '<span class="font-body-md text-body-md font-bold text-on-surface">' + escapeHtml(s.name) + '</span>';
        html += '<span class="font-mono-label text-mono-label bg-surface-container text-on-surface-variant px-xs py-0.5 rounded uppercase">' + (SKILL_TRIGGERS.find(function(t){return t.key===s.trigger_event;})||{label:s.trigger_event}).label + '</span>';
        if (isActive) {
          html += '<span class="font-mono-label text-mono-label bg-primary-container text-on-primary-container px-xs py-0.5 rounded uppercase font-semibold">active</span>';
        }
        html += '</div>';
        html += '<div class="flex gap-xs items-center shrink-0">';
        html += '<button onclick="startEditSkill(\\'' + safeId + '\\')" class="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container-high text-on-surface-variant transition-colors" title="Edit"><span class="material-symbols-outlined text-[18px]">edit</span></button>';
        html += '<button onclick="deleteSkill(\\'' + safeId + '\\')" class="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container-high text-error transition-colors" title="Delete"><span class="material-symbols-outlined text-[18px]">close</span></button>';
        html += '</div>';
        html += '</div>';
        
        html += '<p class="font-body-sm text-body-sm text-on-surface-variant leading-relaxed whitespace-pre-wrap break-words mb-md">' + escapeHtml(s.instructions) + '</p>';
        if (!isActive) {
          html += '<button onclick="activateSkill(\\'' + safeId + '\\',\\'' + escapeAttr(s.trigger_event) + '\\')" class="border border-primary text-primary hover:bg-primary-container/10 font-label-caps text-label-caps px-4 py-1.5 rounded-lg transition-all active:scale-95 shadow-sm">Set as active</button>';
        }
      }
      html += '</div>';
      return html;
    }

    function renderSkillTab() {
      var sk = state.skills;
      var html = '<div class="flex flex-col h-full bg-background">';

      // TopBar
      html += '<header class="flex justify-between items-center px-margin h-16 border-b border-outline-variant bg-surface shrink-0">';
      html += '<div class="flex items-center gap-sm">';
      html += '<span class="material-symbols-outlined text-primary">smart_toy</span>';
      html += '<h1 class="font-headline-md text-headline-md font-bold text-primary">AI Studio</h1>';
      html += '</div>';
      html += '</header>';

      // Content area
      html += '<div class="flex-grow overflow-y-auto px-margin py-md space-y-md max-w-2xl mx-auto w-full pb-24">';

      // Title block
      html += '<div class="flex justify-between items-end pb-xs border-b border-outline-variant/60">';
      html += '<div class="flex flex-col gap-base">';
      html += '<h2 class="font-headline-lg text-headline-lg text-on-surface">Skills</h2>';
      html += '<p class="font-body-sm text-body-sm text-on-surface-variant">One active skill per trigger event. Injected into the AI prompt when that event fires.</p>';
      html += '</div>';
      html += '<button onclick="toggleAddSkill()" class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-4 py-2 rounded-xl transition-all active:scale-95 flex items-center gap-xs shadow-sm">';
      html += '<span class="material-symbols-outlined text-[18px]">add</span>';
      html += '<span>' + (sk.adding ? 'Cancel' : 'New skill') + '</span>';
      html += '</button>';
      html += '</div>';

      if (sk.error) {
        html += '<div class="p-md bg-error-container text-on-error-container border border-error/20 rounded-xl font-body-sm text-body-sm shadow-sm">' + escapeHtml(sk.error) + '</div>';
      }

      if (sk.adding) {
        var triggerOpts = SKILL_TRIGGERS.map(function(t) { return '<option value="' + t.key + '">' + t.label + '</option>'; }).join('');
        var isTranslatingNew = !!sk.isTranslating['new'];
        var currentViewNew = sk.newCurrentView || 'SUMMARIZED';
        
        html += '<div data-skill-id="new" class="bg-surface-container-low border border-primary/40 rounded-xl p-md space-y-sm shadow-md relative">';
        
        if (isTranslatingNew) {
          html += '<div class="absolute inset-0 bg-white/70 z-10 flex flex-col items-center justify-center rounded-xl gap-sm">';
          html += '<div class="spinner w-6 h-6"></div>';
          html += '<span class="font-label-sm text-label-sm font-bold text-on-surface">Translating...</span>';
          html += '</div>';
        }
        
        html += '<div class="flex items-center justify-between gap-sm mb-xs">';
        html += '<span class="font-label-caps text-label-caps text-on-surface-variant">New Skill</span>';
        html += '<div class="flex border border-outline-variant rounded-lg overflow-hidden bg-white p-0.5">';
        html += '<button onclick="toggleEditSkillView(\\'new\\')" class="font-label-sm text-label-sm px-3 py-1 rounded-md transition-colors ' + (currentViewNew === 'LOGICAL' ? 'bg-primary text-on-primary font-semibold shadow-sm' : 'text-on-surface-variant hover:text-on-surface') + '">Logical</button>';
        html += '<button onclick="toggleEditSkillView(\\'new\\')" class="font-label-sm text-label-sm px-3 py-1 rounded-md transition-colors ' + (currentViewNew === 'SUMMARIZED' ? 'bg-primary text-on-primary font-semibold shadow-sm' : 'text-on-surface-variant hover:text-on-surface') + '">Summarized</button>';
        html += '</div>';
        html += '</div>';

        html += '<div class="space-y-sm">';
        html += '<div class="flex gap-sm">';
        html += '<input id="new-skill-name" placeholder="Skill name" value="' + escapeAttr(sk.newName) + '" oninput="state.skills.newName=this.value" class="flex-grow bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">';
        html += '<select id="new-skill-trigger" onchange="state.skills.newTrigger=this.value; render()" class="bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">' + triggerOpts + '</select>';
        html += '</div>';
        
        if (currentViewNew === 'LOGICAL') {
          html += renderLogicalEditor('new', sk.newLogicTree);
        } else {
          html += '<textarea id="new-skill-instructions" placeholder="Describe what the AI should do when this trigger fires — context to check, reply style, behavioral rules, anything." oninput="state.skills.newInstructions=this.value" class="w-full bg-white border border-outline-variant rounded-lg p-md text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm min-h-[120px]" rows="4">' + escapeHtml(sk.newInstructions) + '</textarea>';
        }
        
        html += '</div><div class="flex gap-sm mt-md">';
        html += '<button onclick="submitNewSkill()" class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-6 py-2 rounded-xl transition-all active:scale-95 shadow-sm">Save</button>';
        html += '<button onclick="toggleAddSkill()" class="border border-outline text-on-surface-variant hover:bg-surface-container-high font-label-caps text-label-caps px-6 py-2 rounded-xl transition-all active:scale-95">Cancel</button>';
        html += '</div></div>';
      }

      if (sk.loading && !sk.items.length) {
        html += '<div class="flex items-center justify-center p-xl"><div class="spinner w-8 h-8"></div></div>';
      } else if (!sk.items.length && !sk.adding) {
        html += '<div class="bg-surface-container-low border border-outline-variant rounded-xl p-xl flex flex-col items-center justify-center text-center min-h-[300px]">';
        html += '<div class="w-16 h-16 bg-white border border-outline-variant rounded-2xl flex items-center justify-center mb-md shadow-sm">';
        html += '<span class="material-symbols-outlined text-primary text-3xl">bolt</span>';
        html += '</div>';
        html += '<h3 class="font-headline-md text-headline-md text-on-surface mb-xs">No skills yet</h3>';
        html += '<p class="font-body-sm text-body-sm text-on-surface-variant max-w-sm">Create a skill to guide the AI\\\'s behavior when a trigger fires.</p>';
        html += '</div>';
      } else {
        html += '<div class="space-y-sm">';
        sk.items.forEach(function(s) { html += renderSkillCard(s); });
        html += '</div>';
      }

      html += '</div></div>';
      return html;
    }

    function toggleAddSkill() {
      state.skills.adding = !state.skills.adding;
      state.skills.newName = '';
      state.skills.newInstructions = '';
      state.skills.newTrigger = 'sms_received';
      state.skills.newCurrentView = 'SUMMARIZED';
      var initialTree = [{ id: 'node_' + Math.random().toString(36).slice(2, 9), type: 'IF', condition: '', action: '' }];
      state.skills.newLogicTree = initialTree;
      state.skills.translationCache = {
        instructions: '',
        logicTreeJson: JSON.stringify(initialTree)
      };
      render();
    }
    window.toggleAddSkill = toggleAddSkill;

    async function submitNewSkill() {
      var sk = state.skills;
      var name = sk.newName.trim();
      if (!name) { alert('Skill name is required'); return; }
      var trigger = sk.newTrigger || 'sms_received';
      var current_view = sk.newCurrentView || 'SUMMARIZED';
      var instructions = sk.newInstructions || '';
      var logic_tree_arr = sk.newLogicTree || [];
      var cache = sk.translationCache || {};

      sk.isTranslating['new'] = true;
      render();

      try {
        if (current_view === 'LOGICAL') {
          var currentTreeJson = JSON.stringify(logic_tree_arr);
          if (cache.logicTreeJson !== currentTreeJson) {
            var tr = await fetch('/api/skills/translate/logical-to-summarized', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ logicTree: logic_tree_arr })
            });
            var td = await tr.json();
            if (td.ok) {
              instructions = td.nlSummary;
            } else {
              throw new Error(td.error || 'Failed to translate logic to text before saving');
            }
          } else {
            if (cache.instructions !== undefined) {
              instructions = cache.instructions;
            }
          }
        } else {
          if (cache.instructions !== instructions) {
            var tr = await fetch('/api/skills/translate/summarized-to-logical', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nlSummary: instructions })
            });
            var td = await tr.json();
            if (td.ok) {
              logic_tree_arr = td.logicTree;
            } else {
              throw new Error(td.error || 'Could not parse logic from text before saving');
            }
          } else {
            if (cache.logicTreeJson !== undefined) {
              logic_tree_arr = JSON.parse(cache.logicTreeJson);
            }
          }
        }

        var r = await fetch('/api/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name,
            instructions: instructions,
            trigger_event: trigger,
            current_view: current_view,
            logic_tree: JSON.stringify(logic_tree_arr)
          })
        });
        var d = await r.json();
        if (d.ok) {
          sk.adding = false;
          sk.newName = '';
          sk.newInstructions = '';
          sk.newCurrentView = 'SUMMARIZED';
          sk.newLogicTree = [];
          sk.translationCache = null;
          await loadSkillsAsync();
        } else {
          sk.error = d.error || 'Failed to save';
          render();
        }
      } catch(e) {
        sk.error = e.message;
        render();
      } finally {
        sk.isTranslating['new'] = false;
        render();
      }
    }
    window.submitNewSkill = submitNewSkill;

    async function loadSkillsAsync() {
      var d = await fetch('/api/skills').then(function(r) { return r.json(); });
      if (d.ok) { state.skills.items = d.skills; state.skills.loaded = true; render(); }
    }

    function startEditSkill(id) {
      var skill = state.skills.items.find(function(s) { return s.id === id; });
      if (!skill) return;
      state.skills.editingId = id;
      var parsedLogic = [];
      try {
        parsedLogic = JSON.parse(skill.logic_tree || '[]');
      } catch (e) {
        parsedLogic = [{ id: 'node_' + Math.random().toString(36).slice(2, 9), type: 'IF', condition: '', action: '' }];
      }
      if (!parsedLogic.length) {
        parsedLogic = [{ id: 'node_' + Math.random().toString(36).slice(2, 9), type: 'IF', condition: '', action: '' }];
      }
      state.skills.editContent = {
        name: skill.name,
        instructions: skill.instructions,
        trigger_event: skill.trigger_event,
        current_view: skill.current_view || 'SUMMARIZED',
        logic_tree: parsedLogic
      };
      state.skills.translationCache = {
        instructions: skill.instructions,
        logicTreeJson: JSON.stringify(parsedLogic)
      };
      render();
    }
    window.startEditSkill = startEditSkill;

    function cancelEditSkill() { state.skills.editingId = null; render(); }
    window.cancelEditSkill = cancelEditSkill;

    async function saveEditSkill(id) {
      var sk = state.skills;
      var c = sk.editContent;
      var cache = sk.translationCache || {};
      
      var name = c.name;
      var trigger = c.trigger_event;
      var current_view = c.current_view || 'SUMMARIZED';
      var instructions = c.instructions;
      var logic_tree_arr = c.logic_tree;

      sk.isTranslating[id] = true;
      render();

      try {
        if (current_view === 'LOGICAL') {
          var currentTreeJson = JSON.stringify(logic_tree_arr);
          if (cache.logicTreeJson !== currentTreeJson) {
            // Logic tree has changed! Generate new instructions (nlSummary) via translation
            var tr = await fetch('/api/skills/translate/logical-to-summarized', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ logicTree: logic_tree_arr })
            });
            var td = await tr.json();
            if (td.ok) {
              instructions = td.nlSummary;
              c.instructions = td.nlSummary;
              sk.translationCache = {
                instructions: td.nlSummary,
                logicTreeJson: currentTreeJson
              };
            } else {
              throw new Error(td.error || 'Failed to translate logic to text before saving');
            }
          } else {
            // No changes to logic tree, use cached instructions
            if (cache.instructions !== undefined) {
              instructions = cache.instructions;
            }
          }
        } else {
          // current_view === 'SUMMARIZED'
          if (cache.instructions !== instructions) {
            // Instructions have changed! Generate new logic tree via translation
            var tr = await fetch('/api/skills/translate/summarized-to-logical', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nlSummary: instructions })
            });
            var td = await tr.json();
            if (td.ok) {
              logic_tree_arr = td.logicTree;
              c.logic_tree = td.logicTree;
              sk.translationCache = {
                instructions: instructions,
                logicTreeJson: JSON.stringify(td.logicTree)
              };
            } else {
              throw new Error(td.error || 'Could not parse logic from text before saving');
            }
          } else {
            // No changes to instructions, use cached logic tree
            if (cache.logicTreeJson !== undefined) {
              logic_tree_arr = JSON.parse(cache.logicTreeJson);
            }
          }
        }

        // Now save both to storage
        var r = await fetch('/api/skills/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name,
            instructions: instructions,
            trigger_event: trigger,
            current_view: current_view,
            logic_tree: JSON.stringify(logic_tree_arr)
          })
        });
        var d = await r.json();
        if (d.ok) {
          state.skills.editingId = null;
          await loadSkillsAsync();
        } else {
          state.skills.error = d.error || 'Failed to save';
          render();
        }
      } catch(e) {
        state.skills.error = e.message;
        render();
      } finally {
        sk.isTranslating[id] = false;
        render();
      }
    }
    window.saveEditSkill = saveEditSkill;

    async function activateSkill(id, trigger_event) {
      await fetch('/api/skills/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activate: true, trigger_event: trigger_event }) });
      await loadSkillsAsync();
    }
    window.activateSkill = activateSkill;

async function deleteSkill(id) {
      if (!confirm('Delete this skill?')) return;
      await fetch('/api/skills/' + id, { method: 'DELETE' });
      await loadSkillsAsync();
    }
    window.deleteSkill = deleteSkill;

    function renderSettingsTab() {
      var aiConfigured = state.chat.aiAvailable;
      var activeSection = state.settingsSection || 'ai';

      var html = '<div class="flex flex-col h-full bg-background">';

      // TopBar
      html += '<header class="flex justify-between items-center px-margin h-16 border-b border-outline-variant bg-surface shrink-0">';
      html += '<div class="flex items-center gap-sm">';
      html += '<span class="material-symbols-outlined text-primary">settings</span>';
      html += '<h1 class="font-headline-md text-headline-md font-bold text-primary">Settings</h1>';
      html += '</div>';
      html += '</header>';

      // Inner Layout
      html += '<div class="flex-grow flex flex-col md:flex-row overflow-hidden pb-24 md:pb-0">';

      // Settings Navigation (Sidebar on desktop, topbar scrollable strip on mobile)
      html += '<aside class="flex md:flex-col md:w-56 border-b md:border-b-0 md:border-r border-outline-variant shrink-0 bg-surface p-sm gap-xs overflow-x-auto md:overflow-x-visible md:overflow-y-auto hide-scrollbar">';
      
      var sections = [
        { key: 'ai', label: 'AI Settings', icon: 'smart_toy' },
        { key: 'sms', label: 'SMS Auto-Reply', icon: 'sms' },
        { key: 'integrations', label: 'Integrations', icon: 'extension' },
        { key: 'audit', label: 'Activity Log', icon: 'list_alt' }
      ];

      sections.forEach(function(s) {
        var isActive = activeSection === s.key;
        var btnClass = isActive 
          ? 'bg-surface-container-high text-primary font-semibold border-primary md:border-l-4 md:border-b-0 border-b-2' 
          : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface border-transparent';
        html += '<button onclick="state.settingsSection=\\x27' + s.key + '\\x27; render()" class="flex items-center gap-sm px-md py-2.5 rounded-lg text-body-sm font-body-sm transition-colors whitespace-nowrap outline-none border-b-2 md:border-b-0 md:border-l-4 ' + btnClass + '">';
        html += '<span class="material-symbols-outlined text-[18px] ' + (isActive ? 'text-primary' : '') + '">' + s.icon + '</span>';
        html += '<span>' + s.label + '</span>';
        html += '</button>';
      });
      html += '</aside>';

      // Settings active view content
      html += '<div class="flex-grow p-margin overflow-y-auto max-w-4xl w-full mx-auto">';

      if (activeSection === 'ai') {
        html += '<div class="space-y-lg">';
        html += '  <div class="border-b border-outline-variant pb-xs">';
        html += '    <h2 class="font-headline-lg text-headline-lg text-on-surface">AI Assistant</h2>';
        html += '    <p class="font-body-sm text-body-sm text-on-surface-variant mt-xs">Connect any OpenAI-compatible AI provider.</p>';
        html += '  </div>';

        html += '  <div class="space-y-md max-w-md">';
        html += '    <div class="space-y-xs">';
        html += '      <label class="font-label-caps text-label-caps text-on-surface-variant">Provider</label>';
        html += '      <div id="provider-pills" class="flex flex-wrap gap-xs">' + renderProviderPills() + '</div>';
        html += '    </div>';

        var aiPlaceholder = aiConfigured ? '•••••••••••• (Configured)' : 'sk-ant-...';
        html += '    <div class="space-y-xs">';
        html += '      <label class="font-label-caps text-label-caps text-on-surface-variant">API Key</label>';
        html += '      <input type="password" id="ai-api-key" placeholder="' + aiPlaceholder + '" class="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">';
        html += '    </div>';

        var currentModel = state.chat.configuredModel || '';
        html += '    <div class="space-y-xs">';
        html += '      <label class="font-label-caps text-label-caps text-on-surface-variant">Model <span class="font-normal font-body-sm text-on-surface-variant/75">(optional — uses provider default if blank)</span></label>';
        html += '      <input type="text" id="ai-model" value="' + escapeAttr(currentModel) + '" placeholder="claude-sonnet-4-6" class="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">';
        html += '    </div>';

        html += '    <div class="space-y-xs">';
        html += '      <label class="font-label-caps text-label-caps text-on-surface-variant">Base URL <span class="font-normal font-body-sm text-on-surface-variant/75">(optional — uses provider default if blank)</span></label>';
        html += '      <input type="text" id="ai-base-url" placeholder="https://api.anthropic.com/v1" class="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">';
        html += '    </div>';

        html += '    <div class="flex items-center gap-md pt-sm">';
        html += '      <button onclick="saveAiKey()" class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-6 py-2.5 rounded-xl transition-all active:scale-95 shadow-md">Save Configuration</button>';
        html += '      <span id="ai-flash" class="text-success font-mono-label text-mono-label opacity-0">Saved</span>';
        html += '      <div class="flex items-center gap-xs">';
        html += '        <span class="status-dot ' + (aiConfigured ? 'status-dot-connected' : 'status-dot-disconnected') + '"></span>';
        html += '        <span class="font-label-sm text-label-sm ' + (aiConfigured ? 'text-primary font-semibold' : 'text-on-surface-variant') + '">' + (aiConfigured ? 'Connected' : 'Not configured') + '</span>';
        html += '      </div>';
        html += '    </div>';
        html += '  </div>';
        html += '</div>';
      }

      else if (activeSection === 'sms') {
        html += '<div class="space-y-lg">';
        html += '  <div class="border-b border-outline-variant pb-xs">';
        html += '    <h2 class="font-headline-lg text-headline-lg text-on-surface">SMS Auto-Reply</h2>';
        html += '    <p class="font-body-sm text-body-sm text-on-surface-variant mt-xs">AI automatically replies to incoming SMS while the app is running.</p>';
        html += '  </div>';

        html += '  <div class="space-y-md max-w-xl">';
        html += '    <div class="flex items-center gap-sm bg-white border border-outline-variant rounded-xl p-md shadow-sm">';
        html += '      <label class="relative inline-block w-12 h-6 shrink-0 cursor-' + (state.autoReply.loading ? 'wait' : 'pointer') + '">';
        html += '        <input type="checkbox" ' + (state.autoReply.enabled ? 'checked' : '') + ' onchange="setAutoReply(this.checked)" ' + (state.autoReply.loading ? 'disabled' : '') + ' class="sr-only peer">';
        html += '        <span class="absolute inset-0 bg-secondary rounded-full transition-colors peer-checked:bg-primary"></span>';
        html += '        <span class="absolute left-[2px] top-[2px] w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-6 shadow-sm"></span>';
        html += '      </label>';
        html += '      <div class="flex flex-col gap-base">';
        html += '        <span class="font-body-md text-body-md font-semibold text-on-surface">' + (state.autoReply.enabled ? 'Enabled' : 'Disabled') + '</span>';
        html += '        <span class="font-body-sm text-body-sm text-on-surface-variant">Automatically handle incoming SMS notifications</span>';
        html += '      </div>';
        html += '    </div>';

        if (state.autoReply.enabled) {
          html += '    <div class="p-md bg-surface-container border border-outline-variant rounded-xl font-body-sm text-body-sm text-on-surface-variant space-y-xs shadow-sm">';
          html += '      <div class="flex gap-xs items-center font-semibold text-primary"><span class="material-symbols-outlined text-[18px]">info</span><span>Behavior Note</span></div>';
          html += '      <p>Replies within ~5 seconds while the app is running. Checks SMS history, Calendar, and Gmail before replying. Short codes (e.g., 2FA codes) are automatically skipped. Check the Audit Log for history.</p>';
          html += '    </div>';
        }

        if (!state.chat.aiAvailable && state.autoReply.enabled) {
          html += '    <div class="p-md bg-error-container text-on-error-container border border-error/20 rounded-xl font-body-sm text-body-sm flex gap-xs items-center shadow-sm">';
          html += '      <span class="material-symbols-outlined text-[18px]">warning</span>';
          html += '      <span>AI key required — please configure a provider and key above first.</span>';
          html += '    </div>';
        }

        html += '    <div class="bg-white border border-outline-variant rounded-xl p-md shadow-sm space-y-xs">';
        html += '      <label class="font-label-caps text-label-caps text-on-surface-variant">Context Depth (Tool Rounds)</label>';
        html += '      <div class="flex items-center gap-md">';
        html += '        <input type="number" min="1" max="10" value="' + state.autoReply.maxToolRounds + '" onchange="saveMaxToolRounds(this.value)" class="w-16 bg-white border border-outline-variant rounded-lg px-2 py-1.5 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">';
        html += '        <span class="font-body-sm text-body-sm text-on-surface-variant">(1 = fast, 3 = balanced, 5+ = thorough)</span>';
        html += '      </div>';
        html += '    </div>';

        html += '    <div class="flex items-center gap-md pt-sm">';
        html += '      <button onclick="testAutoReply()" ' + (state.autoReply.testLoading ? 'disabled' : '') + ' class="bg-white hover:bg-surface-container-high border border-outline text-on-surface-variant font-label-caps text-label-caps px-4 py-2.5 rounded-xl transition-all active:scale-95 shadow-sm">' + (state.autoReply.testLoading ? 'Testing...' : 'Test auto-reply') + '</button>';
        if (state.autoReply.testResult) {
          var testColorClass = state.autoReply.testResult.ok ? 'text-primary' : 'text-error';
          html += '      <span class="font-body-sm text-body-sm font-semibold ' + testColorClass + '">' + escapeHtml(state.autoReply.testResult.msg) + '</span>';
        }
        html += '    </div>';
        html += '  </div>';
        html += '</div>';
      }

      else if (activeSection === 'integrations') {
        html += '<div class="space-y-lg">';
        html += '  <div class="border-b border-outline-variant pb-xs">';
        html += '    <h2 class="font-headline-lg text-headline-lg text-on-surface">Integrations</h2>';
        html += '    <p class="font-body-sm text-body-sm text-on-surface-variant mt-xs">Connect services to give the AI access to your data.</p>';
        html += '  </div>';

        html += '  <div class="grid grid-cols-1 md:grid-cols-2 gap-md">';
        state.sources.filter(function(s) { return ['gmail','google_calendar','github'].includes(s.name); }).forEach(function(s) {
          var icons = {
            gmail: 'mail',
            google_calendar: 'calendar_month',
            github: 'code'
          };
          var labels = { gmail: 'Gmail', google_calendar: 'Google Calendar', github: 'GitHub' };
          var tabNames = { gmail: 'gmail', google_calendar: 'google_calendar', github: 'github' };
          var iconName = icons[s.name] || 'extension';
          var label = labels[s.name] || s.name;
          var accountLine = (s.accountInfo && s.accountInfo.email) ? s.accountInfo.email : 'No account details';
          
          html += '  <div class="bg-white border border-outline-variant rounded-xl p-md shadow-sm flex flex-col justify-between gap-md">';
          html += '    <div class="flex items-start gap-sm">';
          html += '      <div class="w-10 h-10 bg-surface-container rounded-lg flex items-center justify-center border border-outline-variant shrink-0">';
          html += '        <span class="material-symbols-outlined text-primary text-[20px]">' + iconName + '</span>';
          html += '      </div>';
          html += '      <div class="min-w-0">';
          html += '        <h3 class="font-body-md text-body-md font-bold text-on-surface leading-tight">' + label + '</h3>';
          html += '        <span class="font-body-sm text-body-sm text-on-surface-variant truncate block mt-0.5">' + accountLine + '</span>';
          html += '      </div>';
          html += '    </div>';
          
          html += '    <div class="flex items-center justify-between border-t border-outline-variant/60 pt-sm">';
          html += '      <div class="flex items-center gap-xs">';
          html += '        <span class="status-dot ' + (s.connected ? 'status-dot-connected' : 'status-dot-disconnected') + '"></span>';
          html += '        <span class="font-label-sm text-label-sm ' + (s.connected ? 'text-primary font-semibold' : 'text-on-surface-variant') + '">' + (s.connected ? 'Connected' : 'Disconnected') + '</span>';
          html += '      </div>';
          
          if (s.connected) {
            html += '    <button onclick="switchTab(\\x27' + tabNames[s.name] + '\\x27)" class="border border-outline hover:bg-surface-container-high text-on-surface-variant font-label-caps text-label-caps px-4 py-1.5 rounded-lg transition-all active:scale-95 flex items-center gap-xs"><span>Manage</span><span class="material-symbols-outlined text-sm">arrow_forward</span></button>';
          } else {
            html += '    <a href="/oauth/' + s.name + '/start" class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-4 py-1.5 rounded-lg transition-all active:scale-95 text-center shadow-sm">Connect</a>';
          }
          html += '    </div>';
          html += '  </div>';
        });
        html += '  </div>';
        html += '</div>';
      }

      else if (activeSection === 'audit') {
        html += '<div class="space-y-lg">';
        html += '  <div class="border-b border-outline-variant pb-xs">';
        html += '    <h2 class="font-headline-lg text-headline-lg text-on-surface">Activity Log</h2>';
        html += '    <p class="font-body-sm text-body-sm text-on-surface-variant mt-xs">Inspect interactions, actions performed, and AI context evaluations.</p>';
        html += '  </div>';

        if (state.audit.length) {
          html += '  <div class="bg-white border border-outline-variant rounded-xl shadow-sm overflow-hidden">';
          html += '    <div class="overflow-x-auto">';
          html += '      <table class="w-full border-collapse text-left text-body-sm font-body-sm">';
          html += '        <thead>';
          html += '          <tr class="bg-surface-container border-b border-outline-variant">';
          html += '            <th class="px-md py-3 font-semibold text-on-surface-variant uppercase text-xs tracking-wider">Time</th>';
          html += '            <th class="px-md py-3 font-semibold text-on-surface-variant uppercase text-xs tracking-wider">Event</th>';
          html += '            <th class="px-md py-3 font-semibold text-on-surface-variant uppercase text-xs tracking-wider">Source</th>';
          html += '            <th class="px-md py-3 font-semibold text-on-surface-variant uppercase text-xs tracking-wider">Details</th>';
          html += '            <th class="px-md py-3 font-semibold text-on-surface-variant uppercase text-xs tracking-wider">Response</th>';
          html += '          </tr>';
          html += '        </thead>';
          html += '        <tbody class="divide-y divide-outline-variant/60">';
          
          state.audit.forEach(function(e) {
            var d = typeof e.details === 'string' ? JSON.parse(e.details) : e.details;
            var resp = d.responseSummary || '';
            var detailsCopy = Object.assign({}, d);
            delete detailsCopy.responseSummary;
            
            var respCell = resp
              ? '<details class="text-body-sm max-w-md cursor-pointer outline-none"><summary class="overflow-hidden text-ellipsis whitespace-nowrap max-w-[280px] text-primary hover:underline font-semibold focus:outline-none">' + formatResponsePreview(resp) + '</summary><div class="mt-base bg-surface-container-low p-2 rounded-lg text-body-sm font-mono-label">' + formatResponseDetails(resp) + '</div></details>'
              : '<span class="text-on-surface-variant/50">-</span>';
              
            html += '      <tr class="hover:bg-surface-container-lowest transition-colors">';
            html += '        <td class="px-md py-3 whitespace-nowrap font-mono-label text-on-surface-variant">' + new Date(e.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</td>';
            html += '        <td class="px-md py-3 whitespace-nowrap font-semibold text-on-surface">' + escapeHtml(e.event) + '</td>';
            html += '        <td class="px-md py-3 whitespace-nowrap"><span class="font-mono-label text-mono-label bg-surface-container px-xs py-0.5 rounded uppercase">' + escapeHtml(e.source || '-') + '</span></td>';
            html += '        <td class="px-md py-3 max-w-[250px] truncate font-mono-label text-[11px] text-on-surface-variant" title="' + escapeAttr(JSON.stringify(detailsCopy)) + '">' + escapeHtml(JSON.stringify(detailsCopy).slice(0, 120)) + (JSON.stringify(detailsCopy).length > 120 ? '...' : '') + '</td>';
            html += '        <td class="px-md py-3">' + respCell + '</td>';
            html += '      </tr>';
          });
          
          html += '        </tbody>';
          html += '      </table>';
          html += '    </div>';
          html += '  </div>';
        } else {
          html += '  <div class="bg-surface-container-low border border-outline-variant rounded-xl p-xl flex flex-col items-center justify-center text-center min-h-[250px]">';
          html += '    <span class="material-symbols-outlined text-primary text-3xl mb-xs">list_alt</span>';
          html += '    <p class="font-body-sm text-body-sm text-on-surface-variant">No activity has been logged yet.</p>';
          html += '  </div>';
        }
        html += '</div>';
      }

      html += '</div>'; // End content area
      html += '</div>'; // End inner layout
      html += '</div>'; // End main container
      return html;
    }

    function toggleEmailExpand(emailId) {
      state.expandedEmail = state.expandedEmail === emailId ? null : emailId;
      render();
    }

    function toggleEditAction(actionId) {
      state.editingAction = state.editingAction === actionId ? null : actionId;
      render();
    }

    // --- Quick filter functions ---
    function renderFilterCards(filters) {
      var types = state.filterTypes || {};
      var typeKeys = Object.keys(types);
      if (!typeKeys.length) return '<p class="empty">Loading filter types...</p>';

      var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">';
      typeKeys.forEach(function(typeKey) {
        var meta = types[typeKey];
        // Find existing filter of this type for gmail
        var existing = filters.find(function(f) { return f.type === typeKey; });
        var isEnabled = existing ? !!existing.enabled : false;
        var value = existing ? (existing.value || '') : '';
        var filterId = existing ? existing.id : '';
        var safeType = escapeAttr(typeKey);
        var needsValue = meta.needsValue;

        html += '<div class="card" style="padding:14px;margin:0;border:1px solid ' + (isEnabled ? 'rgba(15,160,129,0.3)' : 'var(--border)') + ';transition:border-color 0.2s">';
        html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:' + (needsValue ? '10px' : '0') + '">';
        // Toggle switch
        html += '<label style="position:relative;display:inline-block;width:36px;height:20px;margin:0;cursor:pointer;flex-shrink:0">';
        html += '<input type="checkbox" ' + (isEnabled ? 'checked' : '') + ' onchange="toggleFilter(&quot;' + safeType + '&quot;, this.checked, &quot;' + escapeAttr(filterId) + '&quot;)" style="opacity:0;width:0;height:0">';
        html += '<span style="position:absolute;inset:0;background:' + (isEnabled ? 'var(--primary)' : '#ccc') + ';border-radius:10px;transition:background 0.2s"></span>';
        html += '<span style="position:absolute;left:' + (isEnabled ? '18px' : '2px') + ';top:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.2)"></span>';
        html += '</label>';
        html += '<span style="font-size:14px;font-weight:500;color:' + (isEnabled ? 'var(--fg)' : 'var(--muted)') + '">' + escapeHtml(meta.label) + '</span>';
        html += '</div>';
        if (needsValue) {
          html += '<input type="' + (typeKey === 'time_after' ? 'date' : 'text') + '" id="filter-val-' + safeType + '" value="' + escapeAttr(value) + '" placeholder="' + escapeAttr(meta.placeholder) + '" onchange="updateFilterValue(&quot;' + safeType + '&quot;, this.value, &quot;' + escapeAttr(filterId) + '&quot;)" style="width:100%;font-size:13px;padding:6px 10px">';
        }
        html += '</div>';
      });
      html += '</div>';
      return html;
    }

    function renderCalendarFilterCards(filters) {
      var types = state.filterTypes || {};
      var typeKeys = Object.keys(types).filter(function(k) { return k === 'time_after'; }); // Only time_after for calendar for now
      if (!typeKeys.length) return '<p class="empty">Loading filter types...</p>';

      var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">';
      typeKeys.forEach(function(typeKey) {
        var meta = types[typeKey];
        var label = meta.label;
        if (typeKey === 'time_after') label = 'Only events after';

        var existing = filters.find(function(f) { return f.type === typeKey; });
        var isEnabled = existing ? !!existing.enabled : false;
        var value = existing ? (existing.value || '') : '';
        var filterId = existing ? existing.id : '';
        var safeType = escapeAttr(typeKey);
        var needsValue = meta.needsValue;

        html += '<div class="card" style="padding:14px;margin:0;border:1px solid ' + (isEnabled ? 'rgba(15,160,129,0.3)' : 'var(--border)') + ';transition:border-color 0.2s">';
        html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:' + (needsValue ? '10px' : '0') + '">';
        html += '<label style="position:relative;display:inline-block;width:36px;height:20px;margin:0;cursor:pointer;flex-shrink:0">';
        html += '<input type="checkbox" ' + (isEnabled ? 'checked' : '') + ' onchange="toggleCalendarFilter(&quot;' + safeType + '&quot;, this.checked, &quot;' + escapeAttr(filterId) + '&quot;)" style="opacity:0;width:0;height:0">';
        html += '<span style="position:absolute;inset:0;background:' + (isEnabled ? 'var(--primary)' : '#ccc') + ';border-radius:10px;transition:background 0.2s"></span>';
        html += '<span style="position:absolute;left:' + (isEnabled ? '18px' : '2px') + ';top:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.2)"></span>';
        html += '</label>';
        html += '<span style="font-size:14px;font-weight:500;color:' + (isEnabled ? 'var(--fg)' : 'var(--muted)') + '">' + escapeHtml(label) + '</span>';
        html += '</div>';
        if (needsValue) {
          html += '<input type="' + (typeKey === 'time_after' ? 'date' : 'text') + '" id="cal-filter-val-' + safeType + '" value="' + escapeAttr(value) + '" placeholder="' + escapeAttr(meta.placeholder) + '" onchange="updateCalendarFilterValue(&quot;' + safeType + '&quot;, this.value, &quot;' + escapeAttr(filterId) + '&quot;)" style="width:100%;font-size:13px;padding:6px 10px">';
        }
        html += '</div>';
      });
      html += '</div>';
      return html;
    }

    async function toggleCalendarFilter(type, enabled, existingId) {
      var valEl = document.getElementById('cal-filter-val-' + type);
      var value = valEl ? valEl.value : '';
      await fetch('/api/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: existingId || undefined, source: 'google_calendar', type: type, value: value, enabled: enabled ? 1 : 0 })
      });
      state.realEvents = null;
      await fetchData();
    }

    async function updateCalendarFilterValue(type, value, existingId) {
      var filter = (state.filters || []).find(function(f) { return f.type === type && f.source === 'google_calendar'; });
      await fetch('/api/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: existingId || undefined, source: 'google_calendar', type: type, value: value, enabled: filter ? filter.enabled : 0 })
      });
      if (filter && filter.enabled) {
        state.realEvents = null;
        await fetchData();
      } else {
        var filtersData = await fetch('/api/filters').then(function(r) { return r.json(); });
        state.filters = filtersData.filters || [];
      }
    }

    async function toggleFilter(type, enabled, existingId) {
      var valEl = document.getElementById('filter-val-' + type);
      var value = valEl ? valEl.value : '';
      await fetch('/api/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: existingId || undefined, source: 'gmail', type: type, value: value, enabled: enabled ? 1 : 0 })
      });
      // Refresh emails to reflect new filters
      state.realEmails = null;
      await fetchData();
    }

    async function updateFilterValue(type, value, existingId) {
      // Only save if filter is currently enabled
      var filter = (state.filters || []).find(function(f) { return f.type === type && f.source === 'gmail'; });
      await fetch('/api/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: existingId || undefined, source: 'gmail', type: type, value: value, enabled: filter ? filter.enabled : 0 })
      });
      if (filter && filter.enabled) {
        state.realEmails = null;
        await fetchData();
      } else {
        // Still update local state so the value is saved
        var filtersData = await fetch('/api/filters').then(function(r) { return r.json(); });
        state.filters = filtersData.filters || [];
      }
    }

    async function sendAction(actionId) {
      var editTo = document.getElementById('edit-to-' + actionId);
      if (editTo) {
        await fetch('/api/staging/' + actionId + '/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action_data: {
            to: document.getElementById('edit-to-' + actionId).value,
            subject: document.getElementById('edit-subj-' + actionId).value,
            body: document.getElementById('edit-body-' + actionId).value,
            send: true
          }})
        });
      }
      await resolveAction(actionId, 'approve');
    }

    // --- Toggle repo expand/collapse ---
    function toggleRepo(repo) {
      state.expandedRepos[repo] = !state.expandedRepos[repo];
      render();
    }

    function saveGithub() {
      clearTimeout(_saveTimer);
      _saveTimer = setTimeout(function() {
        var payload = {};
        state.github.repoList.forEach(function(r) {
          payload[r.full_name] = {
            enabled: !!r.enabled,
            permissions: typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions
          };
        });
        fetch('/api/github/repos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repos: payload })
        }).then(function() { flash('github-flash'); });
      }, 500);
    }

    async function fetchGithubRepos() {
      state.github.reposLoading = true;
      render();
      try {
        var res = await fetch('/api/github/repos');
        var data = await res.json();
        if (data.ok && data.repos) {
          state.github.repoList = data.repos.map(function(r) {
            return {
              full_name: r.full_name,
              owner: r.owner,
              name: r.name,
              private: r.private,
              description: r.description,
              is_org: r.is_org,
              enabled: r.enabled,
              permissions: r.permissions
            };
          });
          state.github.reposLoaded = true;
        }
      } catch (err) {
        console.error('Failed to fetch GitHub repos:', err);
      }
      state.github.reposLoading = false;
      render();
    }

    function toggleRepoEnabled(fullName, checked) {
      var repo = state.github.repoList.find(function(r) { return r.full_name === fullName; });
      if (repo) {
        repo.enabled = checked ? 1 : 0;
        repo.permissions = checked ? '["contents:read","issues:read","pull_requests:read"]' : '[]';
      }
      saveGithub();
      render();
    }

    function toggleRepoPerm(fullName, perm, checked) {
      var repo = state.github.repoList.find(function(r) { return r.full_name === fullName; });
      if (!repo) return;
      var perms = typeof repo.permissions === 'string' ? JSON.parse(repo.permissions) : repo.permissions.slice();
      if (checked && perms.indexOf(perm) === -1) perms.push(perm);
      if (!checked) perms = perms.filter(function(p) { return p !== perm; });
      repo.permissions = JSON.stringify(perms);
      saveGithub();
      render();
    }

    function selectAllOwner(owner, val) {
      state.github.repoList.forEach(function(r) {
        if (r.owner === owner) {
          r.enabled = val ? 1 : 0;
          r.permissions = val ? '["contents:read","issues:read","pull_requests:read"]' : '[]';
        }
      });
      saveGithub();
      render();
    }

    function applyBulkPerms() {
      var perms = [];
      if (document.getElementById('bulk-code-read').checked) perms.push('contents:read');
      if (document.getElementById('bulk-code-write').checked) perms.push('contents:write');
      if (document.getElementById('bulk-issues-read').checked) perms.push('issues:read');
      if (document.getElementById('bulk-issues-write').checked) perms.push('issues:write');
      if (document.getElementById('bulk-prs-read').checked) perms.push('pull_requests:read');
      if (document.getElementById('bulk-prs-write').checked) perms.push('pull_requests:write');
      var permStr = JSON.stringify(perms);
      state.github.repoList.forEach(function(r) {
        if (r.enabled) r.permissions = permStr;
      });
      saveGithub();
      render();
    }

    function flash(id) {
      var el = document.getElementById(id);
      if (el) { el.classList.add('show'); setTimeout(function() { el.classList.remove('show'); }, 1500); }
      // Also flash sidebar footer
      var sf = document.getElementById('sidebar-flash');
      if (sf) { sf.classList.add('show'); setTimeout(function() { sf.classList.remove('show'); }, 1500); }
    }

    // --- OAuth actions ---
    function startOAuth(source) {
      window.location.href = '/oauth/' + source + '/start';
    }

    async function disconnectSource(source) {
      if (!confirm('Disconnect ' + source + '? You will need to re-authorize.')) return;
      await fetch('/oauth/' + source + '/disconnect', { method: 'POST' });
      if (source === 'gmail') {
        state.realEmails = null;
        state.emailsLoading = false;
      }
      if (source === 'google_calendar') {
        state.realEvents = null;
        state.eventsLoading = false;
      }
      await fetchData();
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function escapeAttr(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function formatResponsePreview(raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed.data && Array.isArray(parsed.data) && parsed.data.length > 0) {
          var items = parsed.data;
          var first = items[0].data || items[0];
          if (first.title || first.author_email || first.subject || first.author_name) {
            var total = (parsed.meta && parsed.meta.itemsReturned) || items.length;
            var subjects = items.map(function(item) {
              var d = item.data || item;
              return d.title || d.subject || '(no subject)';
            });
            var preview = total + ' item(s)';
            if (total > items.length) preview += ' (showing ' + items.length + ')';
            preview += ': ' + subjects.join(', ');
            return escapeHtml(preview);
          }
        }
      } catch(e) {}
      return escapeHtml(raw.slice(0, 160)) + (raw.length > 160 ? '...' : '');
    }

    function formatResponseDetails(raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed.data && Array.isArray(parsed.data) && parsed.data.length > 0) {
          var items = parsed.data;
          var first = items[0].data || items[0];
          if (first.title || first.author_email || first.subject || first.author_name) {
            var html = '<table style="width:100%;font-size:12px;border-collapse:collapse;margin:4px 0">';
            html += '<tr style="background:var(--bg)"><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">From</th><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">Subject</th><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">Date</th><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">Preview</th></tr>';
            items.forEach(function(item) {
              var d = item.data || item;
              var from = d.author_email || d.author_name || d.from || '';
              var subject = d.title || d.subject || '';
              var preview = d.snippet || (d.body ? String(d.body).slice(0, 120) : '') || '';
              var dateStr = d.date || item.timestamp || '';
              var dateFmt = dateStr ? new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
              html += '<tr><td style="padding:4px 8px;border-bottom:1px solid var(--border);white-space:nowrap">' + escapeHtml(from) + '</td><td style="padding:4px 8px;border-bottom:1px solid var(--border)">' + escapeHtml(subject) + '</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);white-space:nowrap;color:var(--muted)">' + escapeHtml(dateFmt) + '</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);color:var(--muted)">' + escapeHtml(preview.slice(0, 120)) + '</td></tr>';
            });
            html += '</table>';
            if (parsed.meta) {
              var total = parsed.meta.itemsReturned || 0;
              var shown = items.length;
              var msg = shown < total
                ? 'Showing ' + shown + ' of ' + total + ' items returned (' + parsed.meta.itemsFetched + ' fetched)'
                : total + ' of ' + parsed.meta.itemsFetched + ' items returned';
              html += '<div style="font-size:11px;color:var(--muted);margin-top:4px">' + escapeHtml(msg) + '</div>';
            }
            return html;
          }
        }
      } catch(e) {}
      return '<pre style="white-space:pre-wrap;word-break:break-all;margin:4px 0;padding:6px;background:var(--bg);border:1px solid var(--border);border-radius:4px;max-height:300px;overflow:auto;font-size:11px">' + raw.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</pre>';
    }

    function relativeTime(dateStr) {
      if (!dateStr) return '';
      var now = Date.now();
      var then = new Date(dateStr + (dateStr.indexOf('Z') === -1 && dateStr.indexOf('+') === -1 ? 'Z' : '')).getTime();
      var diff = Math.floor((now - then) / 1000);
      if (diff < 60) return 'just now';
      if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
      if (diff < 86400) return Math.floor(diff / 3600) + ' hr ago';
      return Math.floor(diff / 86400) + 'd ago';
    }

    function actionTypeLabel(type) {
      var labels = { draft_email: 'Draft Email', send_email: 'Send Email', reply_email: 'Reply' };
      return labels[type] || type;
    }

    function approveLabel(type) {
      var labels = { draft_email: 'Approve & Save Draft', send_email: 'Approve & Send', reply_email: 'Approve & Send Reply' };
      return labels[type] || 'Approve';
    }

    function renderPendingCards(actions) {
      var pending = actions.filter(function(a) { return a.status === 'pending'; });
      if (!pending.length) return '<p class="empty">No pending actions.</p>';
      var html = '';

      pending.forEach(function(a) {
        var data = typeof a.action_data === 'string' ? JSON.parse(a.action_data) : a.action_data;
        var safe = a.action_id.replace(/'/g, "\\\\'");

        // SMS actions are executed client-side via AndroidSms
        if (a.source === 'sms' && a.action_type === 'send_sms') {
          var safeTo = (data.to || '').replace(/'/g, "\\\\'");
          var safeBody = (data.body || '').replace(/'/g, "\\\\'");
          html += '<div class="email-card" id="card-' + a.action_id + '">';
          html += '<div class="email-card-header"><span class="email-card-title">SMS to ' + escapeHtml(data.to || '') + '</span></div>';
          html += '<div class="email-card-meta"><div class="email-field"><span class="email-field-label">To</span><span>' + escapeHtml(data.to || '') + '</span></div></div>';
          html += '<div class="email-card-body"><pre class="email-body-display">' + escapeHtml(data.body || '') + '</pre></div>';
          html += '<div class="email-card-actions">';
          html += '<button class="btn btn-deny" onclick="rejectSmsAction(\\'' + safe + '\\')">Deny</button>';
          html += '<button class="btn btn-approve" onclick="sendSmsAction(\\'' + safe + '\\',\\'' + safeTo + '\\',\\'' + safeBody + '\\')">Send SMS</button>';
          html += '</div></div>';
          return;
        }

        html += '<div class="email-card" id="card-' + a.action_id + '">';
        html += '<div class="email-card-header"><span class="email-card-title">' + escapeHtml(a.purpose || data.subject || 'Untitled') + '</span></div>';
        html += '<div class="email-card-meta">';
        html += '<div class="email-field"><span class="email-field-label">To</span><span id="display-to-' + a.action_id + '">' + escapeHtml(data.to || '') + '</span><input type="text" class="email-edit-input" id="edit-to-' + a.action_id + '" value="' + escapeAttr(data.to || '') + '" style="display:none"></div>';
        html += '<div class="email-field"><span class="email-field-label">Subject</span><span id="display-subj-' + a.action_id + '">' + escapeHtml(data.subject || '') + '</span><input type="text" class="email-edit-input" id="edit-subj-' + a.action_id + '" value="' + escapeAttr(data.subject || '') + '" style="display:none"></div>';
        html += '</div>';
        html += '<div class="email-card-body"><pre class="email-body-display" id="display-body-' + a.action_id + '">' + escapeHtml(data.body || '') + '</pre><textarea class="email-body-edit" id="edit-body-' + a.action_id + '" style="display:none">' + escapeHtml(data.body || '') + '</textarea></div>';
        html += '<div class="email-card-actions">';
        html += '<button class="btn btn-edit" id="edit-btn-' + a.action_id + '" onclick="editAction(\\'' + safe + '\\')">Edit</button>';
        html += '<button class="btn btn-edit" id="cancel-btn-' + a.action_id + '" onclick="cancelEdit(\\'' + safe + '\\')" style="display:none">Cancel</button>';
        html += '<button class="btn btn-deny" onclick="resolveAction(\\'' + safe + '\\', \\'reject\\')">Deny</button>';
        html += '<button class="btn btn-approve" onclick="approveAction(\\'' + safe + '\\')">Approve</button>';
        html += '</div></div>';
      });

      return html;
    }

    function editAction(actionId) {
      ['to', 'subj', 'body'].forEach(function(f) {
        var d = document.getElementById('display-' + f + '-' + actionId);
        var e = document.getElementById('edit-' + f + '-' + actionId);
        if (d) d.style.display = 'none';
        if (e) e.style.display = '';
      });
      var eb = document.getElementById('edit-btn-' + actionId);
      var cb = document.getElementById('cancel-btn-' + actionId);
      if (eb) eb.style.display = 'none';
      if (cb) cb.style.display = '';
    }

    function cancelEdit(actionId) {
      ['to', 'subj', 'body'].forEach(function(f) {
        var d = document.getElementById('display-' + f + '-' + actionId);
        var e = document.getElementById('edit-' + f + '-' + actionId);
        if (d) d.style.display = '';
        if (e) e.style.display = 'none';
      });
      var eb = document.getElementById('edit-btn-' + actionId);
      var cb = document.getElementById('cancel-btn-' + actionId);
      if (eb) eb.style.display = '';
      if (cb) cb.style.display = 'none';
    }

    async function clearAuditLog() {
      if (!confirm('Delete all audit log history? This cannot be undone.')) return;
      await fetch('/api/audit', { method: 'DELETE' });
      state.audit = [];
      render();
    }
    window.clearAuditLog = clearAuditLog;

    async function approveAction(actionId) {
      var editTo = document.getElementById('edit-to-' + actionId);
      if (editTo && editTo.style.display !== 'none') {
        await fetch('/api/staging/' + actionId + '/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action_data: {
            to: document.getElementById('edit-to-' + actionId).value,
            subject: document.getElementById('edit-subj-' + actionId).value,
            body: document.getElementById('edit-body-' + actionId).value
          }})
        });
      }
      await resolveAction(actionId, 'approve');
    }

    async function resolveAction(actionId, decision) {
      await fetch('/api/staging/' + actionId + '/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision })
      });
      await fetchData();
    }

    async function logout() {
      await fetch('/api/logout', { method: 'POST' });
      window.location.reload();
    }

    // Make functions available globally
    window.logout = logout;
    window.startOAuth = startOAuth;
    window.disconnectSource = disconnectSource;
    window.resolveAction = resolveAction;
    window.approveAction = approveAction;
    window.editAction = editAction;
    window.cancelEdit = cancelEdit;
    window.toggleRepo = toggleRepo;
    window.saveGithub = saveGithub;
    window.chk = chk;
    window.fetchGithubRepos = fetchGithubRepos;
    window.toggleRepoEnabled = toggleRepoEnabled;
    window.toggleRepoPerm = toggleRepoPerm;
    window.selectAllOwner = selectAllOwner;
    window.applyBulkPerms = applyBulkPerms;
    window.toggleEmailExpand = toggleEmailExpand;
    window.refreshEmails = function() {
      state.realEmails = null;
      state.emailsError = null;
      state.emailsLoading = false;
      render(); // Show loading state immediately
      fetchData();
    };
    window.refreshCalendarEvents = function() {
      state.realEvents = null;
      state.eventsError = null;
      state.eventsLoading = false;
      render(); // Show loading state immediately
      fetchData();
    };
    window.toggleEditAction = toggleEditAction;
    window.toggleFilter = toggleFilter;
    window.updateFilterValue = updateFilterValue;
    window.renderFilterCards = renderFilterCards;
    window.toggleCalendarFilter = toggleCalendarFilter;
    window.updateCalendarFilterValue = updateCalendarFilterValue;
    window.renderCalendarFilterCards = renderCalendarFilterCards;
    window.sendAction = sendAction;

    // Handle OAuth redirect results (web / query-param path)
    (function handleOAuthResult() {
      var params = new URLSearchParams(window.location.search);
      var success = params.get('oauth_success');
      var error = params.get('oauth_error');
      if (success) {
        fetchData().then(function() { switchTab(success); });
        window.history.replaceState({}, '', '/');
      }
      if (error) {
        alert('OAuth error: ' + error);
        window.history.replaceState({}, '', '/');
      }
    })();

    // Handle OAuth deep-link callbacks on Android (pdh://oauth?success=<source>).
    // The browser-side token exchange page redirects here after storing tokens,
    // which triggers the Android intent filter and fires appUrlOpen in Capacitor.
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.addListener('appUrlOpen', function(event) {
        try {
          var url = new URL(event.url);
          if (url.hostname === 'oauth') {
            var success = url.searchParams.get('success');
            var error = url.searchParams.get('error');
            if (success) {
              fetchData().then(function() { switchTab(success); });
            }
            if (error) {
              alert('OAuth error: ' + error);
            }
          }
        } catch(e) {}
      });
    }

    // --- Auth: signup vs login form ---
    var isSignup = false;

    function setAuthMode(signup) {
      isSignup = signup;
      document.getElementById('login-subtitle').textContent = signup ? 'Create your account' : 'Sign in to continue';
      document.getElementById('auth-submit').textContent = signup ? 'Create Account' : 'Sign In';
      document.getElementById('auth-toggle').textContent = signup ? 'Already have an account? Sign in' : 'New here? Create account';
      document.getElementById('login-error').textContent = '';
    }

    function toggleAuthMode() {
      setAuthMode(!isSignup);
    }
    window.toggleAuthMode = toggleAuthMode;

    function handleAuthSubmit(e) {
      e.preventDefault();
      var email = document.getElementById('auth-email').value;
      var password = document.getElementById('auth-password').value;
      var errorEl = document.getElementById('login-error');
      var btn = document.getElementById('auth-submit');
      errorEl.textContent = '';
      btn.disabled = true;
      btn.textContent = isSignup ? 'Creating account...' : 'Signing in...';

      var endpoint = isSignup ? '/auth/signup' : '/auth/login';
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password }),
      }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, status: r.status, data: d }; }); })
      .then(function(res) {
        btn.disabled = false;
        btn.textContent = isSignup ? 'Create Account' : 'Sign In';
        if (res.data.ok) {
          document.getElementById('login-screen').style.display = 'none';
          document.getElementById('app').style.display = 'flex';
          fetchData();
        } else if (res.status === 409) {
          // Account already exists — switch to sign-in mode automatically
          setAuthMode(false);
          errorEl.textContent = 'Account exists. Please sign in with your password.';
        } else {
          errorEl.textContent = res.data.error || 'Authentication failed';
        }
      }).catch(function() {
        btn.disabled = false;
        btn.textContent = isSignup ? 'Create Account' : 'Sign In';
        errorEl.textContent = 'Network error. Please try again.';
      });
      return false;
    }
    window.handleAuthSubmit = handleAuthSubmit;

    // Poll for drain-path pending auto-replies: when the app was killed and SMS was queued,
    // android.ts replays them with ?drain=true and stores in pendingAutoReplies.
    // This polling picks them up and sends via AndroidSms once the WebView is active.
    setInterval(async function() {
      if (!state.autoReply.enabled || !window.AndroidSms) return;
      try {
        var res = await fetch('/api/sms/pending-replies');
        var d = await res.json();
        if (!d.ok || !d.replies || !d.replies.length) return;
        d.replies.forEach(function(r) {
          var cbId = 'autoreply_' + r.id;
          window._smsSendCbs[cbId] = function(error) {
            if (error) console.warn('[auto-reply] send error:', error);
            fetch('/api/sms/pending-replies/' + r.id, { method: 'DELETE' }).catch(function() {});
          };
          window.AndroidSms.sendMessage(cbId, r.to, r.body);
        });
      } catch(e) { /* non-fatal */ }
    }, 3000);

    // Primary auto-reply loop: poll inbox every 5s, detect new incoming messages,
    // call /sms/auto-reply, and send the reply via AndroidSms directly.
    // This uses the same proven path as manual reply and doesn't depend on SmsReceiver.
    var _autoReplyLastMs = Date.now(); // only process messages that arrive after startup
    setInterval(function() {
      if (!state.autoReply.enabled || !window.AndroidSms || !state.chat.aiAvailable) return;
      if (!window._smsCbs) window._smsCbs = {};
      var reqId = 'autocheck_' + Date.now();
      var checkFrom = _autoReplyLastMs;
      _autoReplyLastMs = Date.now();
      window._smsCbs[reqId] = async function(messages, error) {
        if (error || !Array.isArray(messages)) return;
        // type 1 = received SMS
        var newMsgs = messages.filter(function(m) { return m.type == 1 && m.date > checkFrom; });
        for (var i = 0; i < newMsgs.length; i++) {
          var msg = newMsgs[i];
          try {
            // Collect last 10 messages in this conversation for context
            var history = messages
              .filter(function(m) { return m.address === msg.address; })
              .sort(function(a, b) { return a.date - b.date; })
              .slice(-10);
            var res = await fetch('/sms/auto-reply', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ from: msg.address, body: msg.body, history: history }),
            });
            var d = await res.json();
            if (d.ok && d.enabled && d.reply) {
              var cbId = 'arloop_' + Date.now() + '_' + i;
              window._smsSendCbs[cbId] = function(err) {
                if (err) console.warn('[auto-reply] send failed:', err);
              };
              window.AndroidSms.sendMessage(cbId, msg.address, d.reply);
            }
          } catch(e) { /* non-fatal */ }
        }
      };
      window.AndroidSms.getMessages(reqId, 'inbox', 50);
    }, 5000);

    // Check auth on load — auto-login for single-device use
    fetch('/api/auth/status').then(function(r) { return r.json(); }).then(function(data) {
      if (data.authenticated) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        fetchData();
      } else {
        // Auto-create user + session (device is localhost — no credentials needed)
        fetch('/auth/device-login', { method: 'POST' })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (d.ok) {
              document.getElementById('login-screen').style.display = 'none';
              document.getElementById('app').style.display = 'flex';
              fetchData();
            } else {
              document.getElementById('login-screen').style.display = 'flex';
              document.getElementById('app').style.display = 'none';
              setAuthMode(!data.hasUsers);
            }
          })
          .catch(function() {
            document.getElementById('login-screen').style.display = 'flex';
            document.getElementById('app').style.display = 'none';
            setAuthMode(false);
          });
      }
    }).catch(function() {
      document.getElementById('login-screen').style.display = 'flex';
      document.getElementById('app').style.display = 'none';
      setAuthMode(false);
    });
  </script>
</body>
</html>`;
}
