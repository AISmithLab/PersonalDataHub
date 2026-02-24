# Development Guide

How the codebase is structured and how to modify it.

## Project Structure

```
PersonalDataHub/
├── src/
│   ├── index.ts                 # Entry point — loads config, creates DB, starts server
│   ├── config/                  # Configuration system
│   │   ├── types.ts             # TypeScript interfaces (HubConfig, SourceConfig, etc.)
│   │   ├── schema.ts            # Zod schemas for config validation
│   │   └── loader.ts            # YAML loading with ${ENV_VAR} resolution
│   ├── db/                      # Database layer
│   │   ├── db.ts                # SQLite connection (WAL mode, foreign keys)
│   │   ├── schema.ts            # CREATE TABLE statements (6 tables)
│   │   └── encryption.ts        # AES-256-GCM encrypt/decrypt for cached data
│   ├── connectors/              # Source service integrations
│   │   ├── types.ts             # DataRow interface, SourceConnector interface
│   │   ├── gmail/
│   │   │   └── connector.ts     # Gmail fetch, executeAction, sync
│   │   └── github/
│   │       ├── connector.ts     # GitHub access validation, fetch issues/PRs
│   │       └── setup.ts         # Grant/revoke collaborator access
│   ├── fixtures/
│   │   └── emails.ts            # Synthetic demo email dataset (15 emails)
│   ├── demo.ts                  # Load/unload demo data into DB
│   ├── filters.ts               # Quick filter types, catalog, and apply logic
│   ├── sync/
│   │   └── scheduler.ts         # Background cache sync (fetch + store)
│   ├── audit/
│   │   └── log.ts               # AuditLog class — typed write methods + filtered queries
│   ├── server/                  # HTTP layer
│   │   ├── server.ts            # Hono app setup, mounts API + GUI routes
│   │   └── app-api.ts           # POST /pull, POST /propose with API key auth
│   └── gui/
│       └── routes.ts            # Self-contained HTML GUI with inline JS
├── packages/
│   └── personaldatahub/       # OpenClaw skill
│       └── src/
│           ├── index.ts         # Plugin registration
│           ├── hub-client.ts    # HTTP client for PersonalDataHub API
│           ├── tools.ts         # personal_data_pull, personal_data_propose tools
│           └── prompts.ts       # System prompt for teaching agents
├── tests/
│   └── e2e/                     # End-to-end integration tests
│       ├── helpers.ts           # Shared setup (mock connector, in-memory DB)
│       ├── gmail-recent-readonly.test.ts
│       ├── gmail-metadata-only.test.ts
│       ├── gmail-full-access-redacted.test.ts
│       ├── gmail-staged-action.test.ts
│       └── gmail-cache-sync.test.ts
├── docs/                        # Design docs
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
| Database | better-sqlite3 (WAL mode) |
| Encryption | AES-256-GCM (application-level) |
| HTTP Server | Hono (bound to 127.0.0.1) |
| Config | YAML + Zod validation |
| Gmail API | googleapis |
| GitHub API | octokit |
| Tests | Vitest |
| Package Manager | pnpm |

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

Six tables in SQLite:

| Table | Purpose |
|---|---|
| `api_keys` | Hashed API keys for agent authentication |
| `filters` | Quick filter definitions per source (type, value, enabled) |
| `cached_data` | Encrypted local cache of source data (optional) |
| `staging` | Outbound actions pending owner review |
| `audit_log` | Every data movement with timestamps and purpose |
| `manifests` | Legacy — retained for backward compatibility |

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
  fetch(boundary: Record<string, unknown>, params?: Record<string, unknown>): Promise<DataRow[]>;
  executeAction?(actionType: string, actionData: Record<string, unknown>): Promise<{ success: boolean }>;
  sync?(db: Database, encryptionKey: string): Promise<void>;
}
```

2. Register the connector in `src/index.ts` by adding it to the connector registry.

3. Add tests in `src/connectors/<source>/<source>.test.ts`.

4. The connector maps source API responses into `DataRow[]` — all content goes in `data`, the four fixed fields (`source`, `source_item_id`, `type`, `timestamp`) are set at the top level.

## How Data Flows

### Pull request (`POST /app/v1/pull`)

1. The server verifies the API key
2. If cache is enabled for the source, reads from the `cached_data` table; otherwise fetches live from the connector
3. Loads enabled quick filters from the `filters` table for that source
4. Applies filters: row predicates first (time_after, from_include, etc.), then field removal (hide_field)
5. Returns the filtered data

```
Request → API key check → fetch data (cache or live) → apply filters → response
```

### Background sync (cache enabled)

1. A timer fires at the configured `sync_interval`
2. Fetches all data from the connector within the configured boundary
3. Upserts rows into `cached_data` with optional AES-256-GCM encryption
4. No filters applied during sync — everything is cached, filters are applied at read time

### Propose action (`POST /app/v1/propose`)

1. The server verifies the API key
2. Inserts the action into the `staging` table with status `pending`
3. Owner reviews in the GUI and approves/rejects
4. On approval, the connector's `executeAction` is called

## Demo Data

You can load synthetic email data to try the full pull flow without connecting a real Gmail account. Demo data is inserted directly into `cached_data`, so pull requests serve it without needing OAuth or a live connector.

```bash
# Load 15 synthetic emails
npx pdh demo-load

# Start the server, then pull
npx pdh start
curl -X POST http://localhost:3000/app/v1/pull \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"source": "gmail", "purpose": "Test demo pull"}'

# Remove all demo data when done
npx pdh demo-unload
```

You can then configure quick filters in the GUI to see how they affect the returned data. Demo data is identified by prefix: emails have `source_item_id` starting with `demo_`. Loading is idempotent (safe to run multiple times).

## Testing

Tests are co-located with source files (`*.test.ts`) for unit tests, and in `tests/e2e/` for integration tests.

The e2e tests use an in-memory SQLite database and a mock Gmail connector (defined in `tests/e2e/helpers.ts`) so they run without external services.

To run a specific test file:

```bash
npx vitest run tests/e2e/gmail-recent-readonly.test.ts
```

## OpenClaw Skill

The skill in `packages/personaldatahub/` is a standalone package with its own `tsconfig.json` and test suite. It wraps the two PersonalDataHub API endpoints as OpenClaw tools.

To work on it:

```bash
cd packages/personaldatahub
pnpm test
```

The skill has no dependency on the main PersonalDataHub source — it only talks to the Hub over HTTP.
