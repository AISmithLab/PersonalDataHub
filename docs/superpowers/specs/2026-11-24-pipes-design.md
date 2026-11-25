# Pipes design

Date: 2026-11-24. Status: awaiting approval.

## Intent

A pipe is a small filter program over one data source. The owner describes it in Chat ("the emails that ask for recommendation letters"), the chat AI writes it, and it becomes its own HTTP endpoint that agents on the same device can call. The Pipe tab lists the pipes; selecting one shows its API and the output of running it now.

Why: today an agent can only call `POST /app/v1/pull`, which returns everything the quick filters let through. A pipe lets the owner hand an agent one narrow, named view of the data.

## Goals

- New bottom tab "Pipe". The Skill tab is unchanged.
- Pipes are created and changed by talking to Chat.
- Each pipe has a URL that ends in a unique code.
- A table of contents endpoint lists the pipes and their URLs.
- The Pipe tab shows, for the selected pipe: its API, its program, and its current output.
- Pipe endpoints answer only callers on the same device.

## Non-goals

- Reaching pipes from other devices on the network.
- Pipes over SMS, contacts, or photos. SMS and contacts live in the device bridge, not in server connectors. Photos cannot be pulled through `/pull` today and `ask()` is text only, so a photo pipe would need its own rules.
- Pipes that write, send, or stage actions. A pipe only reads and returns rows.
- Chaining pipes, schedules, or triggers.
- An MCP tool for pipes (`src/ai/mcp/server.ts`). HTTP only for now.
- The legacy GUI at `/` (`src/gateway/gui/frontend/`). Only `packages/ui` gets the tab (served at `/next` on the web and natively in the mobile app).

## Anti-goals

- A pipe must never return more than `/pull` would for the same source. Quick filters and EXIF stripping apply before the program sees a row.
- A pipe program is not handed files, the network, or the process. This guards against mistakes, not against a hostile program: Node's `vm` is not a security boundary, and the chat AI that writes pipes already has `run_code` with full access. Pipes are held to the same trust level as `run_code`, with less within reach. (My call.)

## Approaches

Network exposure, decided by Haojian:

1. Separate listener on a second port open to the Wi-Fi, serving only pipe routes. Lets a laptop agent call the phone hub; adds a port and address checks.
2. **Picked: pipes on the existing server, same device only.** The hub binds `127.0.0.1` on desktop, Android and iOS (`src/gateway/server.ts`, `src/android.ts`, `src/ios.ts`). Haojian: "it's by design that only the local device can visit."
3. Open the main server to the Wi-Fi and block non-pipe routes for outside callers. Rejected: one missed route exposes the GUI or chat.

Program model (my call):

1. Declarative filter spec, like the existing quick filters. Cannot express "asks for a recommendation letter".
2. A stored prompt, with the model filtering all rows on every call. No program to show, slow, and the model sees and can echo everything.
3. **Picked: plain JavaScript plus one `ask()` helper.** Matches "each pipe will be a simple filter program"; the program is short and readable in the tab; judgment calls go through `ask()`, which returns only true or false.

## Design

### Data

New table `pipes` (SQLite and sql.js schemas; DynamoDB store stubs the methods the same way it stubs skills):

| column | notes |
|---|---|
| `id` | primary key and the URL code: 8 random characters from `a-z2-7` |
| `name` | short name |
| `description` | one sentence, shown in the table of contents |
| `source` | `gmail`, `google_calendar`, or `github` |
| `query` | optional connector search string that sets the window the pipe looks at, for example `newer_than:60d` for Gmail. Empty means the newest items. |
| `program` | JavaScript source |
| `enabled` | 0 or 1, default 1 |
| `created_at`, `updated_at` | |

`DataStore` gains `listPipes`, `getPipe`, `insertPipe`, `updatePipe`, `deletePipe`.

### The program

The program is the body of an async function. It receives `rows` and `ask`, and must return an array.

```js
const out = [];
for (const r of rows) {
  const text = r.data.title + '\n' + r.data.body;
  if (await ask('Does this email ask me to write a recommendation letter?', text)) out.push(r);
}
return out;
```

- `rows`: the `DataRow` objects `/pull` would return for that source (`{ source, source_item_id, type, timestamp, data }`), after quick filters, as a deep copy.
- `ask(question, text)`: asks the configured AI model a yes/no question about `text` and resolves to a boolean. Throws if no AI key is configured. Text is cut at 4000 characters.
- At most 5 `ask()` calls run at once; further calls wait. The chat AI is told to judge rows with `Promise.all` so a 50-row pipe finishes inside the time limit.
- The program may drop rows and may also trim fields from the rows it keeps.
- Return value must be an array that survives `JSON.stringify`; anything else is an error.

### Running a pipe

One function, `runPipe(deps, pipe, { limit })`, used by the agent endpoint, the tab, and the chat tool:

1. Fetch from the connector with the source's configured boundary, the pipe's `query`, and `limit` (default 20, maximum 50). Cut the result to `limit` after fetching, because not every connector honors it.
2. Apply enabled quick filters (`applyFilters`).
3. Run the program in a new `vm` context that contains only `rows`, `ask`, and a console that discards output. No `require`, `fetch`, `process`, `Buffer`, or timers. Pass `rows` in as JSON and parse it inside the context. This is a separate, narrower runner than `run_code`'s; put it beside it in `src/gateway/code-runner/`.
4. Time limit 120 seconds total, same two-layer timeout as `runCode`. Known limit, shared with `run_code`: an endless synchronous loop after the first `await` is not interrupted.
5. Return `{ rows, itemsFetched, duration_ms }` or an error string. Never throw.

The example above is sequential for readability; the system prompt's version uses `Promise.all`.

`ask()` answers are cached in memory, keyed by a hash of question and text, so calling a pipe again does not ask the model again about items it has already judged. The cache is lost on restart. (My call.)

### Agent API

In `src/gateway/app-api.ts`, no login, like the other `/app/v1` routes:

```
GET /app/v1/pipes
  -> { ok, pipes: [{ name, description, source, url }] }      enabled pipes only

GET /app/v1/pipes/:code?limit=20&purpose=...
  -> { ok, pipe: { name, description, source }, data: [...], meta: { itemsFetched, itemsReturned, duration_ms } }
```

- `url` is absolute, built from the request's own origin.
- `purpose` is optional and written to the audit log when given. (My call: `/pull` requires it, but a pipe already states its purpose in its description.)
- Errors use the existing shape `{ ok: false, error: { code, message } }`: `NOT_FOUND` (unknown or disabled code), `SOURCE_NOT_CONNECTED`, `PIPE_ERROR` (program threw, timed out, or returned a non-array; message included).
- Every call writes an audit entry `pipe_run` with the pipe id, name, caller (`agent` or `owner`), counts, duration, and error.
- Both routes refuse any caller whose socket address is not loopback, with 403. This makes "same device only" an explicit rule instead of a side effect of the bind address, and it also turns pipes off on Lambda, where there is no socket. (My call.)

The code is an identifier, not a secret: the table of contents lists every URL. The loopback rule is the protection.

Add a short Pipes section to `packages/personaldatahub/SKILL.md` describing the two endpoints.

### Owner API

Session-protected, in `src/gateway/gui/routes.ts`:

```
GET    /api/pipes            all pipes, including program and disabled ones
PUT    /api/pipes/:id        { enabled }   toggle only
DELETE /api/pipes/:id
POST   /api/pipes/:id/run    same result shape as the agent endpoint; works for disabled pipes
```

There is no create or edit-program route for the GUI. Pipes are written through Chat. (My call.)

### Chat

Three new tools in `buildTools` (`src/gateway/chat/routes.ts`), plus one system prompt paragraph that states the program contract above:

- `list_pipes()`
- `save_pipe({ id?, name, description, source, query?, program, enabled? })`: creates or updates, then runs the pipe once with `limit` 10 and returns `{ id, url, itemsFetched, itemsReturned, sample: first 3 rows trimmed, error? }` so the AI can see whether its program works and fix it in the same turn. The pipe is saved even if the test run fails.
- `delete_pipe({ id })`

`save_pipe` rejects a `source` outside the three allowed. Creation, update and deletion write audit entries, like skills.

### Pipe tab

`packages/ui/src/tabs/PipeTab.tsx`, fifth bottom tab, placed between Skill and Memory, with a new `pipe` icon in `TabIcon`. The app is phone-width, so the tab is a list that opens into a detail view, not two columns.

List:

```
Pipes
Filter programs that agents on this device can call.
Table of contents: GET http://127.0.0.1:3000/app/v1/pipes   [Copy]

┌──────────────────────────────────────────────┐
│ Recommendation letter requests      [on ●]   │
│ gmail · /app/v1/pipes/k7f3q9x2               │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│ Meetings with students              [off ○]  │
│ google_calendar · /app/v1/pipes/m2c8t5ya     │
└──────────────────────────────────────────────┘
```

Empty state: "No pipes yet. Describe a filter in Chat to create one."

Detail (after tapping a pipe):

```
‹ Pipes
Recommendation letter requests                [on ●]
Emails that ask me to write a recommendation letter.

API
GET http://127.0.0.1:3000/app/v1/pipes/k7f3q9x2       [Copy]

Program
┌──────────────────────────────────────────────┐
│ const out = [];                              │
│ for (const r of rows) { ...                  │
└──────────────────────────────────────────────┘

Output                    3 of 20 items · 4.1 s   [Run again]
┌──────────────────────────────────────────────┐
│ Letter for PhD applications                  │
│ a.student@uni.edu · Nov 22                   │
└──────────────────────────────────────────────┘
  ...
[Show raw JSON]                               [Delete pipe]
```

- Output runs when the detail opens and on "Run again". While running it shows a spinner; on error it shows the error message in the error style used by the Skill tab.
- Each output row shows a title line and a sub line picked from common fields (`title`, `author_email` or `author_name`, timestamp). "Show raw JSON" shows the exact response body an agent would get.
- The program is read-only.
- The displayed base URL is the hub's own origin as the client already knows it (`packages/ui/src/api/baseUrl*`).

State and API calls follow the skills pattern in `useAppState.ts` and `api/client.ts`.

## Left to the builder

- Exact sandbox mechanics and how the loopback check reads the socket address under `@hono/node-server`, including how tests supply it.
- Whether `runPipe` and the `ask` cache live in one file or two.
- Icon drawing, spacing, and the field-picking rule for output rows on non-email sources.
- Copy buttons on native (clipboard module availability); a selectable text field is acceptable if no clipboard module is installed.

## Testing

Vitest, alongside the existing tests:

- Pipe runner: returns filtered rows; `require`, `fetch` and `process` are undefined inside; non-array return and thrown errors come back as errors; an endless loop before the first `await` times out; `ask` is cached and limited to 5 at once.
- Store: pipe create, read, update, delete on the SQLite store.
- Agent routes: table of contents lists only enabled pipes; run returns filtered data and writes an audit entry; unknown and disabled codes give 404; a non-loopback caller gets 403; quick filters apply before the program.
- Chat tool: `save_pipe` creates a pipe and returns the test run; a bad source is rejected.
- UI: type check, then a manual pass at `/next` in a browser: create a pipe in Chat, open it in the Pipe tab, see API and output, toggle, delete.
