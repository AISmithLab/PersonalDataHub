# Development Guide

How the codebase is structured and how to modify it.

## Project Structure

```
PersonalDataHub/
├── src/
│   ├── index.ts                 # Entry point — loads config, creates DB, starts server
│   ├── cli.ts                   # CLI commands (init, start, stop, status, install-service, uninstall-service, reset)
│   ├── android.ts               # Android mobile entry point (bundled by scripts/bundle-mobile.cjs)
│   ├── ios.ts                   # iOS mobile entry point (bundled by scripts/bundle-mobile.cjs)
│   ├── app.ts                   # Creates the Hono app (shared by desktop + mobile)
│   ├── config/                  # Configuration system
│   │   ├── schema.ts            # Zod schemas for config validation
│   │   └── loader.ts            # YAML loading with ${ENV_VAR} resolution
│   ├── database/                # Database layer
│   │   ├── db.ts                # SQLite connection (WAL mode, foreign keys)
│   │   ├── schema.ts            # CREATE TABLE statements (better-sqlite3)
│   │   ├── schema-sqljs.ts      # CREATE TABLE statements (sql.js, used on mobile)
│   │   ├── encryption.ts        # AES-256-GCM encrypt/decrypt for OAuth tokens
│   │   ├── datastore.ts         # DataStore interface
│   │   ├── sqlite-store.ts      # better-sqlite3 implementation (desktop/server)
│   │   ├── sqljs-store.ts       # sql.js implementation (mobile — no native bindings)
│   │   └── dynamo-store.ts      # DynamoDB implementation (Lambda)
│   ├── gateway/                 # HTTP layer
│   │   ├── gateway.ts           # Hono app setup, mounts sub-routers
│   │   ├── server.ts            # HTTP server start/stop
│   │   ├── app-api.ts           # POST /pull, POST /propose, GET /sources
│   │   ├── auth/                # OAuth flows and token management
│   │   ├── connectors/          # Source service integrations (Gmail, GitHub, …)
│   │   │   └── gmail/
│   │   │   └── github/
│   │   ├── filters.ts           # Quick filter types, catalog, and apply logic
│   │   ├── audit/               # AuditLog class
│   │   ├── chat/                # Chat/AI routes
│   │   ├── code-runner/         # Code execution routes
│   │   └── gui/                 # Self-contained HTML GUI with inline JS
│   └── test-utils.ts            # Shared test utilities
├── mobile/                      # React Native app
│   ├── App.tsx                  # Root component — starts Node.js thread, loads WebView
│   ├── android/                 # Android Gradle project
│   ├── ios/                     # iOS Xcode project
│   ├── nodejs-assets/           # Pre-bundled Node.js backend (generated, not committed)
│   │   └── nodejs-project/      # Output of scripts/bundle-mobile.cjs
│   └── package.json             # RN dependencies and build scripts
├── scripts/
│   ├── bundle-mobile.cjs        # esbuild: compiles src/android.ts + src/ios.ts for mobile
│   └── setup-android.cjs        # Auto-generates mobile/android/local.properties
├── packages/
│   └── personaldatahub/         # OpenClaw skill
├── tests/
│   └── e2e/                     # End-to-end integration tests
├── systemdesigns/               # Documentation
├── hub-config.example.yaml
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── eslint.config.js
```

## Tech Stack

| Component | Choice |
|---|---|
| Language | TypeScript (strict, ESM, NodeNext modules) |
| Runtime | Node.js >= 22 |
| Database (desktop/server) | better-sqlite3 (WAL mode) |
| Database (mobile) | sql.js (pure JS + WASM — no native bindings required) |
| Encryption | AES-256-GCM (application-level, for OAuth tokens) |
| HTTP Server | Hono (bound to 127.0.0.1) |
| Agent Protocol | REST under `/agent/*`, called through the `query-hub` command (`bin/query-hub.mjs`, no dependencies) |
| Config | YAML + Zod validation |
| Gmail API | googleapis |
| GitHub API | octokit |
| Mobile framework | React Native 0.86 |
| Mobile Node.js runtime | nodejs-mobile-react-native |
| Mobile bundler | esbuild (via scripts/bundle-mobile.cjs) |
| Tests | Vitest |
| Package Manager | pnpm (desktop), npm (mobile/) |

## Development Commands

```bash
# Build
pnpm build

# Watch mode for TypeScript
pnpm dev

# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Lint
pnpm lint
```

## Database Schema

Tables in SQLite:

| Table | Purpose |
|---|---|
| `oauth_tokens` | Encrypted OAuth tokens per source |
| `agents` | Registered agents (name, permissions, SHA-256 hash of the token; the token itself is never stored) |
| `join_codes` | One-time join codes (permissions, expiry, when used) |
| `users`, `sessions` | The owner account (bcrypt-hashed password) and its browser sessions |
| `filters` | Quick filter definitions per source (type, value, enabled) |
| `staging` | Outbound actions pending owner review |
| `audit_log` | Every data movement with timestamps and purpose |

## Key Data Types

### DataRow

The normalized shape for all source data:

```typescript
type DataRow = {
  source: string;           // "gmail", "github"
  source_item_id: string;   // original ID in source system
  type: string;             // "email", "issue", "pr", "commit"
  timestamp: string;        // ISO 8601
  data: Record<string, unknown>;  // all content fields
}
```

### QuickFilter

Stored in the `filters` table:

```typescript
type QuickFilter = {
  id: string;
  source: string;     // "gmail", "github"
  type: string;       // "time_after", "from_include", "subject_include", etc.
  value: string;      // filter value (e.g., date, sender name, field name)
  enabled: number;    // 1 = active, 0 = disabled
}
```

Available filter types: `time_after`, `from_include`, `subject_include`, `exclude_sender`, `exclude_keyword`, `has_attachment`, `hide_field`.

## How to Add a New Source Connector

1. Create `src/connectors/<source>/connector.ts` implementing `SourceConnector`:

```typescript
interface SourceConnector {
  name: string;
  fetch(boundary: SourceBoundary, params?: Record<string, unknown>): Promise<DataRow[]>;
  executeAction(actionType: string, actionData: Record<string, unknown>): Promise<ActionResult>;
}
```

2. Register the connector in `src/index.ts` by adding it to the connector registry.

3. Add the source name to `AGENT_SOURCES` in `src/gateway/agents.ts` so the owner can grant `pull:<source>` and `propose:<source>` to agents, and to the `Sources:` line in the usage text of `bin/query-hub.mjs`. `query-hub pull` and `query-hub propose` take the source as an argument, so no per-source client code is needed.

4. Add tests in `src/connectors/<source>/<source>.test.ts`.

5. The connector maps source API responses into `DataRow[]` — all content goes in `data`, the four fixed fields (`source`, `source_item_id`, `type`, `timestamp`) are set at the top level.

## How Data Flows

### Route layout

Two prefixes, each with one credential (see `src/gateway/server.ts` and `src/gateway/auth/access.ts`):

| Prefix | Caller | Credential |
|---|---|---|
| `/web/*` | The GUI and the mobile app | Owner: session cookie, or the device secret on the phone |
| `/agent/*` | Agents | A registered agent's token (`Authorization: Bearer pdh_...`), or the owner |

Unauthenticated by necessity: `GET /health`, the pages (`/`, `/next`), `/web/auth/{signup,login,status}`, the two OAuth routes the provider's flow calls (`GET /oauth/:source/callback`, protected by the one-time state; `POST /oauth/:source/store-tokens`, protected by a one-time ticket), and the two join routes (`GET /agent/join/:code`, `POST /agent/join`, protected by the one-time code in the join link). The join routes are mounted in front of the agent check because an agent redeeming a link has no token yet. They answer 404 on a hub that uses the device secret (the phone app).

Agent registration lives in `src/gateway/agents.ts`. The owner routes are `POST /web/agents/join-links`, `GET /web/agents`, `PUT /web/agents/:id` (change permissions), and `DELETE /web/agents/:id` (revoke). A permission is `pull:<source>` or `propose:<source>`. `/agent/pull` and `/agent/propose` answer 403 when the agent lacks the one they need.

New owner routes go in `gui/routes.ts` or `chat/routes.ts` (they are mounted under `/web`, so write the path without the prefix). New agent routes go in `app-api.ts`.

### Pull request (`POST /agent/pull`)

1. Fetches live data from the connector using the configured boundary
2. Loads enabled quick filters from the `filters` table for that source
3. Applies filters: row predicates first (time_after, from_include, etc.), then field removal (hide_field)
4. Logs the access to the audit log
5. Returns the filtered data

```
Request → fetch data (live from source) → apply filters → audit log → response
```

### `query-hub` call (e.g., `query-hub pull gmail`)

1. Agent runs `query-hub pull gmail --purpose <why>` in a shell
2. `query-hub` reads the hub address and token from its token file and builds the request body from the arguments
3. Calls `POST /agent/pull` with `Authorization: Bearer <token>`
4. Prints the JSON response on stdout, or a one-line error on stderr with exit code 1

```
Agent → query-hub → fetch(hub/agent/pull) → HTTP server → token and permission check → connector → filters → response
```

### Propose action (`POST /agent/propose`)

1. Inserts the action into the `staging` table with status `pending`
2. Logs the proposal to the audit log
3. Owner reviews in the GUI and approves/rejects
4. On approval, the connector's `executeAction` is called

## Testing

Tests are co-located with source files (`*.test.ts`) for unit tests, and in `tests/e2e/` for integration tests.

The e2e tests use an in-memory SQLite database and a mock Gmail connector (defined in `tests/e2e/helpers.ts`) so they run without external services.

To run a specific test file:

```bash
npx vitest run tests/e2e/gmail-recent-readonly.test.ts
```

To run just the `query-hub` and agent registration tests:

```bash
npx vitest run src/query-hub.test.ts src/gateway/agents.test.ts
```

## OpenClaw Skill

The skill in `packages/personaldatahub/` is a standalone package with its own `tsconfig.json` and test suite. It wraps the PersonalDataHub API endpoints as OpenClaw tools.

To work on it:

```bash
cd packages/personaldatahub
pnpm test
```

The skill has no dependency on the main PersonalDataHub source — it only talks to the Hub over HTTP.

## query-hub

`bin/query-hub.mjs` is the agent's client: one Node file with no dependencies, exposed as the `query-hub` command by `package.json`. It is the source copy; smithagent carries a copy of it.

- `join` redeems a join link with `POST /agent/join` and writes `{ hub, token, agent_name, agent_id }` to `$QUERY_HUB_CONFIG`, or `~/.pdh/agent.json`, with mode `0600`. The token is never printed.
- `me`, `sources`, `pull`, `propose`, and `leave` call the matching `/agent/*` route with the stored token.
- A 401 is reported as "revoked". A 403 names the missing permission.

To try it against a running hub, create a join link in Settings → Agents, then:

```bash
QUERY_HUB_CONFIG=/tmp/test-agent.json node bin/query-hub.mjs join <join-link> --name test-agent
QUERY_HUB_CONFIG=/tmp/test-agent.json node bin/query-hub.mjs me
```

`~/.pdh/config.json` (`hubUrl`, `hubDir`) is used only by the `pdh` command. Agents do not read it.
