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

`/web/*`: the website and the mobile app. Owner credential (session cookie `pdh_session`, or the device secret on the phone), except `signup`, `login`, `status`.

| Old | New |
|---|---|
| `POST /auth/signup`, `/auth/login` | `POST /web/auth/signup`, `/web/auth/login` |
| `POST /auth/device-login` | removed; see Device secret |
| `POST /api/logout`, `GET /api/auth/status` | `POST /web/auth/logout`, `GET /web/auth/status` |
| `GET /oauth/:source/start` | `POST /web/oauth/:source/start`, returns `{ ok, url }`; the caller opens `url` |
| `POST /oauth/:source/disconnect` | `POST /web/oauth/:source/disconnect` |
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
- `POST /oauth/:source/store-tokens?ticket=...`: called by the callback page, which on the phone runs in the system browser and so has neither cookie nor device secret. Protected by a one-time ticket the callback issues. Today it has no protection at all.
- `GET /` and `GET /next`: serve the page.

## Authentication

Agent keys:

- Table `agent_keys`: `id`, `name`, `key_hash` (SHA-256 of the key; keys are 32 random bytes, so a slow hash adds nothing), `created_at`, `last_used_at`.
- `POST /web/agent-keys { name }` returns the key once (`pk_` + 43 base64url characters). Only the hash is stored.
- `/agent/*` middleware: accept a valid owner session cookie, else a valid Bearer key, else 401. The audit entry for pull and propose records the key name, or `owner`.
- Settings gets an "Agent keys" section: list, create (shows the key once), delete.
- CLI: `pdh init` creates a first key named `default` and writes it to `~/.pdh/config.json` beside `hubUrl`, so the MCP server and `packages/personaldatahub` keep working after setup. Both read `apiKey` from that file and send it. (My call.)

Device secret (found while planning; replaces the earlier `/web/auth/device` idea):

- The phone app has no login screen. Instead of a login route, every request from the app carries `X-PDH-Device-Secret`, and `/web/*` and `/agent/*` accept it as an owner credential.
- The secret is `process.env.PDH_DEVICE_SECRET`. Only `src/android.ts` and `src/ios.ts` set it: 32 random bytes, generated on first start and kept in `<dataDir>/device-secret`, inside the app's private storage. On desktop and Lambda the variable is unset and the header is ignored.
- The Node process hands the secret to the React Native shell over the `rn-bridge` channel; the shell passes it to the shared UI with `setDeviceSecret()`. The Android `SmsReceiver` reads the file.
- Desktop and Lambda use email and password. The shared UI gains a sign-in / create-account screen, shown when `/web/auth/status` says not authenticated. (The legacy page already has one.)
- Mobile changes cannot be verified in this environment (no device build); they are type-checked only.

Added after an independent review of the first implementation:

- **Same-origin rule for the cookie.** `SameSite=Lax` does not separate ports on `127.0.0.1`, so a page a local agent serves on another port could use the owner's cookie. The cookie is now accepted only when the browser does not report another origin (`Origin` host equals the hub's, and `Sec-Fetch-Site` is `same-origin`, `none`, or absent). Signup and login apply the same rule.
- **No accounts on a device-secret hub.** The phone never creates an account, so "first signup claims the hub" was open to any local app. Signup and login answer 404 when a device secret is configured.
- **One-time values expire** after ten minutes (OAuth state and store-tokens ticket).
- **`pdh key [name]`** creates a key for a hub that was set up before keys existed.

Known and not addressed here:

- On desktop, between `pdh init` and the owner creating the account, the first caller to sign up owns the hub. This "first signup claims" rule predates this work.
- The Android `SmsReceiver` queues missed messages under `files/pdh-data/sms_queue`, while the server under `nodejs-mobile-react-native` appears to keep its data one directory higher. If so, queued messages are never replayed. Predates this work; the receiver now looks in both places for the device secret, but the queue path is unchanged.
- The old Capacitor shell (`android/`, `www/`) is not built by CI and was not updated; it would get 404 and a sign-in page.

## Callers to update

`packages/ui` (all calls go through `api/client.ts` and a few direct fetches), `src/gateway/gui/frontend/js/*` (paths only), `src/ai/mcp/server.ts`, `packages/personaldatahub` (client, `SKILL.md`, tests), `src/cli.ts`, `mobile/App.tsx`, `mobile/android/.../SmsReceiver.java`, `src/android.ts` (SMS queue drain), `skills/*/SKILL.md`, `README.md`, `systemdesigns/*.md`, tests.

Outside the repo: Haojian's `~/.claude/skills/personaldatahub.md` needs the new paths and a key. Not changed by this work.

## Testing

- Existing suites pass on the new paths.
- New tests: `/agent/*` without credentials is 401; with a valid key 200; with a deleted key 401; with the owner cookie 200. `/web/*` without a cookie is 401. The device secret header is accepted when the variable is set and matches, ignored when unset. `store-tokens` without a valid ticket is 401, and a ticket works once. Old paths return 404.
- Manual: log in at `/next`, create a key, call `/agent/pull` with curl.
