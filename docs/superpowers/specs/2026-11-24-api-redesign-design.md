# API redesign

Date: 2026-11-24. Status: approved by Haojian in conversation ("yes. now it makes sense. please update them.").

## Intent

The hub's routes grew three prefixes (`/auth`, `/api`, `/app/v1`) plus loose ones (`/sms`, `/device`), and the agent routes have no authentication. Haojian: there are two types of API, one for the website itself and one for the data flow to agents; the naming is awkward; "ideally, all of them requires authentication."

## Goals

- Two prefixes, each with one credential.
- Every route authenticated, apart from the three listed exceptions.
- All in-repo callers moved to the new paths. No aliases for old paths.

## Non-goals

- Pipes (separate design, built on top of this).
- Per-key permissions or scopes. A key is all-or-nothing for now.
- New features in the legacy page at `/`. It only gets its paths updated.
- Rate limiting.

## Approaches

1. **Picked: `/web/*` with session cookie, `/agent/*` with agent key.** Matches the two types Haojian named.
2. Keep the three prefixes and only add authentication. Rejected: the naming is the complaint.
3. One prefix with per-route roles. Rejected: the caller's type would no longer be visible in the URL.

## Layout

`/web/*`: the website and the mobile app. Session cookie `pdh_session`, except `signup`, `login`, `device`, `status`.

| Old | New |
|---|---|
| `POST /auth/signup`, `/auth/login`, `/auth/device-login` | `POST /web/auth/signup`, `/web/auth/login`, `/web/auth/device` |
| `POST /api/logout`, `GET /api/auth/status` | `POST /web/auth/logout`, `GET /web/auth/status` |
| `GET /oauth/:source/start`, `POST /oauth/:source/store-tokens`, `POST /oauth/:source/disconnect` | `/web/oauth/:source/start`, `/web/oauth/:source/store-tokens`, `/web/oauth/:source/disconnect` |
| `/api/<anything else>` | `/web/<same>` |
| `POST /device/contacts-sync` | `POST /web/device/contacts` |
| `POST /api/photos/sync` | `POST /web/device/photos` |
| `POST /sms/auto-reply` | `POST /web/device/sms/auto-reply` |
| `/api/sms/manual-reply`, `/api/sms/pending-replies` | `/web/device/sms/manual-reply`, `/web/device/sms/pending-replies` |
| new | `GET /web/agent-keys`, `POST /web/agent-keys`, `DELETE /web/agent-keys/:id` |

`/agent/*`: the data flow. Agent key in `Authorization: Bearer pk_...`, or the owner's session cookie.

| Old | New |
|---|---|
| `GET /app/v1/sources` | `GET /agent/sources` |
| `POST /app/v1/pull` | `POST /agent/pull` |
| `POST /app/v1/propose` | `POST /agent/propose` |

Exceptions, unauthenticated by necessity:

- `GET /health`.
- `GET /oauth/:source/callback`: the URL is registered with Google and GitHub; protected by the one-time state value.
- `GET /` and `GET /next`: serve the page.

## Authentication

Agent keys:

- Table `agent_keys`: `id`, `name`, `key_hash` (SHA-256 of the key; keys are 32 random bytes, so a slow hash adds nothing), `created_at`, `last_used_at`.
- `POST /web/agent-keys { name }` returns the key once (`pk_` + 43 base64url characters). Only the hash is stored.
- `/agent/*` middleware: accept a valid owner session cookie, else a valid Bearer key, else 401. The audit entry for pull and propose records the key name, or `owner`.
- Settings gets an "Agent keys" section: list, create (shows the key once), delete.
- CLI: `pdh init` creates a first key named `default` and writes it to `~/.pdh/config.json` beside `hubUrl`, so the MCP server and `packages/personaldatahub` keep working after setup. Both read `apiKey` from that file and send it. (My call.)

Device login:

- `POST /web/auth/device` requires a header `X-PDH-Device-Secret` equal to `process.env.PDH_DEVICE_SECRET`. If the variable is unset the route answers 404.
- The mobile shell generates the secret at startup, passes it to the Node process when it starts it, and gives it to the shared UI. The Android `SmsReceiver` and the contacts sync in `mobile/App.tsx` send the same header; `/web/device/*` accepts the device secret as an alternative to the session cookie, since those callers run before or outside the UI's login.
- Desktop keeps email and password login.

## Callers to update

`packages/ui` (all calls go through `api/client.ts` and a few direct fetches), `src/gateway/gui/frontend/js/*` (paths only), `src/ai/mcp/server.ts`, `packages/personaldatahub` (client, `SKILL.md`, tests), `src/cli.ts`, `mobile/App.tsx`, `mobile/android/.../SmsReceiver.java`, `src/android.ts` (SMS queue drain), `skills/*/SKILL.md`, `README.md`, `systemdesigns/*.md`, tests.

Outside the repo: Haojian's `~/.claude/skills/personaldatahub.md` needs the new paths and a key. Not changed by this work.

## Testing

- Existing suites pass on the new paths.
- New tests: `/agent/*` without credentials is 401; with a valid key 200; with a deleted key 401; with the owner cookie 200. `/web/*` without a cookie is 401. `/web/auth/device` without the secret is rejected, with it returns a session, with the variable unset is 404. Old paths return 404.
- Manual: log in at `/next`, create a key, call `/agent/pull` with curl.
