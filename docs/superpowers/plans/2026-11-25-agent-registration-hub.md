# Agent Registration (hub side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents register with the hub through one-time join links made in Settings, get per-source permissions, and reach the hub with `query-hub`; the MCP server and agent keys are removed.

**Architecture:** `agents` and `join_codes` tables replace `agent_keys`. `requireAgent` resolves a `pdh_` token to an agent and its permissions; `app-api.ts` checks them per call. Join routes sit in front of `requireAgent` on the `/agent` sub-app. `bin/query-hub` is a dependency-free Node client.

**Tech Stack:** TypeScript, Hono, better-sqlite3 / sql.js / DynamoDB, vitest, React Native (packages/ui), Node (query-hub).

**Spec:** `docs/superpowers/specs/2026-11-25-agent-registration-design.md` (Part 1 only; Part 2, smithagent, is a later plan in Lab-AI-Infra).

## Global Constraints

- `npm test` and `npx tsc --noEmit` (root, `packages/ui`, `packages/personaldatahub`, `mobile`) stay green after every task. Lint error count does not rise above 70.
- Token: `pdh_` + 32 random bytes base64url, stored as SHA-256 hex. Join code: 24 random bytes hex, single use, 15 minutes.
- Permissions: `pull:<source>`, `propose:<source>`; sources `gmail`, `google_calendar`, `github`, `photo`.
- Agent name: `^[a-z0-9][a-z0-9-]{0,62}$`, `owner` reserved.
- Unauthenticated `/agent` routes are exactly `GET /agent/join/:code` and `POST /agent/join`; both answer 404 when `PDH_DEVICE_SECRET` is set.
- A token is never returned by any route except the 201 of `POST /agent/join`, and never printed by `query-hub`.
- `pdh init|start|stop|status|install-service|uninstall-service|reset` keep working; `~/.pdh/config.json` holds only `hubUrl` and `hubDir`.

## Review Focus

- Two agents joining with the same name at the same moment: one gets 409 and its code stays usable.
- A revoked agent's very next call is 401, and `query-hub` says the agent was revoked rather than printing raw JSON.
- An agent with `pull:github` only cannot pull or propose for gmail, and does not see gmail in `sources`.
- `query-hub join` on a machine that already has a token file must not silently overwrite it.
- A join link opened in a browser (GET) must not consume the code.

Tests for each are in Tasks 2, 2, 3, 5, 2.

---

### Task 1: Storage

**Files:** `src/database/{datastore,schema,schema-sqljs,sqlite-store,sqljs-store,dynamo-store}.ts`, `src/database/db.test.ts`.

**Produces:** `AgentRow {id,name,token_hash,permissions,created_at,last_used_at}`, `JoinCodeRow {code,permissions,created_at,expires_at,used_at}`; `listAgents`, `insertAgent`, `getAgentByTokenHash`, `touchAgent`, `updateAgentPermissions(id, permissions)`, `deleteAgent(id)`, `insertJoinCode`, `getJoinCode(code)`, `consumeJoinCode(code): boolean` (true only for the first caller), `releaseJoinCode(code)`. `permissions` is stored as a JSON string. Remove every `agent_keys` method and table.

- [ ] Tests: agent CRUD; `consumeJoinCode` true then false; release makes it consumable again; unique name.

### Task 2: Join and agent management routes

**Files:** `src/gateway/auth/access.ts`, new `src/gateway/agents.ts` (+ test), `src/gateway/server.ts`, `src/gateway/gui/routes.ts`, `src/gateway/auth/access.test.ts`, `src/test-utils.ts`.

**Produces:** `access.ts`: `newAgentToken()`, `hashToken()`, `AccessEnv.Variables = { caller: string; permissions: string[] | null; agentId: string | null }` (`null` permissions = owner), `allows(c, permission)`. `agents.ts`: `normalizePermissions(input): string[] | null`, `isValidAgentName`, `createAgentOwnerRoutes(deps)` (mounted at `/web/agents`), `createJoinRoutes(deps)` (mounted on `/agent` before `requireAgent`).

- [ ] Tests: everything under "Join" and "Revoke and leave" in the spec; GET page does not consume; same-name race; device-secret 404; agent token cannot call `/web/agents*`; route walk passes with the two join routes on its open list.

### Task 3: Permission checks

**Files:** `src/gateway/app-api.ts` (+ `/me`, `/leave`), tests in `src/gateway/agents.test.ts`.

- [ ] pull needs `pull:<source>`, propose needs `propose:<source>`, 403 `FORBIDDEN` with `error.permission`; `sources` filtered; owner passes; permission change applies on the next call.

### Task 4: CLI and MCP removal

**Files:** delete `src/ai/mcp/`; `src/cli.ts`, `src/cli.test.ts`, `package.json` (+ lockfile), `packages/personaldatahub/src/{index,setup,hub-client}.ts` and tests.

- [ ] Remove `mcp` and `key` commands, `createKey`, `apiKey` in `HubConfig` and in `init`.
- [ ] Plugin reads `{hub, token}` from `QUERY_HUB_CONFIG` or `~/.pdh/agent.json` when its own settings are empty.
- [ ] Test: no file under `src/` or `package.json` mentions `modelcontextprotocol` or `pdh mcp`.

### Task 5: query-hub

**Files:** new `bin/query-hub.mjs`, `package.json` (`bin`, `files`), new `src/query-hub.test.ts` (spawns the script against a real server on an ephemeral port).

- [ ] Commands and error messages as in the spec. `join` refuses when a token file exists (tells the user to `leave` first).
- [ ] Tests: join → me → sources → pull → propose → revoke at hub → me reports revoked (exit 1); leave deletes the file; token never appears in stdout or stderr; forbidden pull names the permission; hub down message.

### Task 6: Settings → Agents

**Files:** `packages/ui/src/api/client.ts`, new `components/AgentsForm.tsx`, delete `AgentKeysForm.tsx`, `App.tsx`; rebuild pages.

- [ ] List, add (permission grid, link panel with copy and command, list refresh while open), edit, revoke. Hidden when `Platform.OS !== 'web'`.
- [ ] Manual pass in a browser on a scratch hub, joining with `bin/query-hub.mjs`.

### Task 7: Docs and skills

- [ ] `README.md`, `systemdesigns/{SETUP,DEVELOPMENT,SECURITY}.md`, `skills/*/SKILL.md`, `packages/personaldatahub/SKILL.md`: MCP out, join links and `query-hub` in.
