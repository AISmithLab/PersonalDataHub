# API Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every hub route under `/web/*` (owner) or `/agent/*` (agent key) and authenticate all of them.

**Architecture:** One auth module provides `requireOwner` and `requireAgent` middleware. `server.ts` mounts a `/web` sub-app and an `/agent` sub-app behind them; route files lose their own prefixes and middleware. Callers are updated in place; old paths are removed.

**Tech Stack:** TypeScript, Hono, better-sqlite3 / sql.js / DynamoDB stores, vitest, React Native (shared UI in `packages/ui`).

**Spec:** `docs/superpowers/specs/2026-11-24-api-redesign-design.md`

## Global Constraints

- Baseline before this work: `npm test` 183 passing, `npx tsc --noEmit` clean at the root and in `packages/ui`. Both must hold after every task. `npm run lint` has 71 existing errors; add none.
- No aliases for old paths.
- Unauthenticated routes are exactly: `GET /health`, `GET /`, `GET /next`, `GET /oauth/:source/callback`, `POST /oauth/:source/store-tokens` (ticket), `POST /web/auth/signup`, `POST /web/auth/login`, `GET /web/auth/status`.
- Agent key format: `pk_` + 32 random bytes base64url. Stored as SHA-256 hex.
- Device secret header: `X-PDH-Device-Secret`; env `PDH_DEVICE_SECRET`.

## Review Focus

- A request with a deleted agent key must get 401 on the next call.
- An unset or empty `PDH_DEVICE_SECRET` must never match an empty header.
- A store-tokens ticket must not be reusable, and a Gmail ticket must not store Calendar tokens.
- The legacy page at `/` must still load data after login (its paths are rewritten by hand, not typed).
- A first-run desktop user (no account) must reach the create-account form in the new UI, not a blank screen.

Each has a test in the task that owns it (Tasks 1, 1, 3, 5, 6).

---

### Task 1: Auth module and agent keys

**Files:** create `src/gateway/auth/access.ts`, `src/gateway/auth/access.test.ts`; modify `src/database/datastore.ts`, `schema.ts`, `schema-sqljs.ts`, `sqlite-store.ts`, `sqljs-store.ts`, `dynamo-store.ts`.

**Produces:**
- `DataStore`: `listAgentKeys(): AgentKeyRow[]`, `insertAgentKey({id,name,key_hash})`, `getAgentKeyByHash(hash): AgentKeyRow|null`, `touchAgentKey(id)`, `deleteAgentKey(id)`. `AgentKeyRow = {id,name,key_hash,created_at,last_used_at}`.
- `access.ts`: `parseCookie`, `newAgentKey(): {key, hash}`, `hashAgentKey(key)`, `isOwner(c, store)`, `requireOwner(store)`, `requireAgent(store)` (sets `c.set('caller', 'owner' | keyName)`).

- [ ] Tests: owner cookie passes both; no credential 401; valid key passes `requireAgent` only; deleted key 401; device secret matches only when env set and non-empty.
- [ ] Implement, run tests, commit.

### Task 2: Server layout

**Files:** modify `src/gateway/server.ts`, `app-api.ts`, `gui/routes.ts`, `chat/routes.ts`, `auth/login-routes.ts`; all server tests.

- [ ] `login-routes.ts`: `signup`, `login`, `logout`, `status`; delete `device-login`.
- [ ] `gui/routes.ts`, `chat/routes.ts`: drop the `/api` prefix and their own middleware; move `GET /` and `GET /next` into an exported `createPageRoutes`; apply the renames in the spec's table; add `agent-keys` routes.
- [ ] `server.ts`: `/health`, `/oauth` (callback + store-tokens), `/web/auth`, `/web/*` behind `requireOwner`, `/agent/*` behind `requireAgent`, pages.
- [ ] `app-api.ts`: audit entries use `c.get('caller')`.
- [ ] Update existing tests to new paths and credentials; add: old paths 404, `/agent/pull` 401 without key, `/web/filters` 401 without cookie.
- [ ] Run tests, commit.

### Task 3: OAuth

**Files:** modify `src/gateway/auth/oauth-routes.ts`; test alongside.

- [ ] Split into `createOAuthOwnerRoutes` (`POST /:source/start` returning `{ok,url}`, `POST /:source/disconnect`) and `createOAuthPublicRoutes` (`GET /:source/callback`, `POST /:source/store-tokens`).
- [ ] Callback issues a ticket (`setOAuthState('ticket_'+random, {source,...})`) and puts it in the store URL; store-tokens consumes it and checks the source.
- [ ] Tests: no ticket 401; ticket works once; wrong-source ticket 401.

### Task 4: Agent-side callers

**Files:** `src/cli.ts`, `src/ai/mcp/server.ts`, `packages/personaldatahub/src/*`, tests.

- [ ] `pdh init` creates key `default`, writes `apiKey` to `~/.pdh/config.json`.
- [ ] MCP server and hub client send `Authorization: Bearer <apiKey>` to `/agent/*`.

### Task 5: Legacy page

**Files:** `src/gateway/gui/frontend/js/*.js`, `index.html`.

- [ ] Rewrite paths; remove the device-login attempt; OAuth start becomes a POST then redirect.
- [ ] `gui.test.ts`: the generated page contains no `/api/`, `/auth/` or `/app/v1` strings.

### Task 6: Shared UI

**Files:** `packages/ui/src/api/client.ts`, `hooks/useAppState.ts`, new `components/LoginScreen.tsx`, `App.tsx`, Settings "Agent keys" section, files with direct fetches.

- [ ] `client.ts`: new paths; `setDeviceSecret(secret)`; header added to every request when set; `startOAuth(source)`; agent-key calls.
- [ ] `LoginScreen`: email + password; create-account mode when `hasUsers` is false. Shown by `App` when not authenticated.
- [ ] Type check; manual pass at `/next`: create account, see tabs load, create a key, `curl /agent/pull` with it.

### Task 7: Mobile shell

**Files:** `src/android.ts`, `src/ios.ts`, `mobile/App.tsx`, `mobile/android/.../SmsReceiver.java`, `scripts/bundle-mobile.cjs`.

- [ ] Node: generate/load device secret, set env, send over `rn-bridge`; SMS queue drain uses the new path and header.
- [ ] Shell: receive secret, `setDeviceSecret`, new paths. `SmsReceiver`: read the file, send the header, new path.
- [ ] Type check only; say so in the report.

### Task 8: Docs

- [ ] `README.md`, `systemdesigns/{SETUP,DEVELOPMENT,SECURITY,OAUTH-SETUP}.md`, `skills/*/SKILL.md`, `packages/personaldatahub/SKILL.md`: new paths and the key. Historical design notes under `systemdesigns/architecture-design/` are left as they are.
