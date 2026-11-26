# Outgoing Pipes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add outgoing pipes, programs that pass or block an agent's action and carry out what passes at once, plus a log for every pipe, and remove the old proposal path.

**Architecture:** `pipes` gains `direction` and `test_actions`; a new `pipe_log` table records every agent call. Outgoing logic (normalising an action, running the gate program, carrying it out) lives in a new `src/gateway/pipes-outgoing.ts`; logging in `src/gateway/pipe-log.ts`. `pipes.ts` routes dispatch on direction. The desktop Pipes page gets a kind marker, an outgoing panel and a Log tab.

**Tech Stack:** TypeScript, Hono, better-sqlite3 / sql.js / DynamoDB stores, Node `vm`, vitest; vanilla JS desktop page built by `node scripts/build-frontend.mjs`; dependency-free `bin/query-hub.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-26-outgoing-pipes-design.md`

## Global Constraints

- Every path by which an agent can make something go out goes through an outgoing pipe's program and writes a `pipe_log` entry before the response returns.
- Outgoing programs run in the existing vm sandbox with the same timeout, and have no `ask`, network, files or timers.
- A program that throws, times out, or returns anything other than the result of `pass()` / `block(reason)` blocks the action (fail closed).
- `direction` and `source` of a pipe never change after creation.
- An outgoing pipe is created off; saving any change to an outgoing pipe switches it off; only the owner's `PUT /web/pipes/:id { enabled: true }` switches it on. The chat can never enable an outgoing pipe.
- Test runs (panel and `save_pipe`) never execute an action and never write `pipe_log`.
- `pipe_log` keeps the newest 500 entries per pipe; deleting a pipe deletes its log.
- Outgoing pipes are refused on the DynamoDB store.
- Action types: gmail `send_email`, `reply_email`, `draft_email`; google_calendar `create_event`, `update_event`, `delete_event`.
- Desktop page `/` is the UI; `/next` only gets what keeps it working (no propose ticks).
- Build the page with `node scripts/build-frontend.mjs`; full check is `npx tsc && npm test`.

## Review Focus

1. **Header injection.** `subject: "Hi\r\nBcc: x@evil.com"` or a `to` containing CR/LF would add headers in `createMimeMessage`. Expect: rejected with 400 before the program runs. Test in Task 2.
2. **Forged pass.** A program returning `true`, `"pass"`, `{ outcome: 'pass' }` or nothing. Expect: blocked; only the value `pass()` returned in that run counts. Test in Task 2.
3. **Fields the program never saw.** An agent sends `cc`, `bcc`, `attendees` as objects, extra keys. Expect: the connector gets exactly the normalised fields the program saw; unknown keys are dropped; `attendees` (which sends invitations) is normalised to lowercased addresses and visible to the program. Test in Task 2.
4. **Connector fails after a pass.** Gmail throws or returns `success: false`. Expect: response `outcome: "failed"`, a `failed` log entry, never reported as sent. Test in Task 4.
5. **Pipe switched off or edited during a call.** Expect: the pipe row is read once at the start of the request and that version decides; a pipe that is off at that moment is 409 `PIPE_OFF` and nothing runs. Test in Task 4.

---

### Task 1: Store: direction, test actions, pipe log

**Files:**
- Modify: `src/database/datastore.ts` (PipeRow, DataStore), `src/database/schema.ts`, `src/database/schema-sqljs.ts`, `src/database/sqlite-store.ts`, `src/database/sqljs-store.ts`, `src/database/dynamo-store.ts`
- Test: `src/database/pipe-store.test.ts` (new)

**Interfaces:**
- Produces:
  - `PipeRow` gains `direction: 'incoming' | 'outgoing'` and `test_actions: string` (JSON, default `'[]'`).
  - `insertPipe(pipe)` and `updatePipe(id, fields)` accept `direction` (insert only) and `test_actions`.
  - `interface PipeLogRow { id: number; pipe_id: string; at: string; caller: string; purpose: string; outcome: string; summary: string; duration_ms: number }`
  - `DataStore.insertPipeLog(entry: Omit<PipeLogRow, 'id' | 'at'>): MaybePromise<void>`: inserts, then deletes that pipe's entries beyond the newest 500.
  - `DataStore.listPipeLog(pipeId: string, opts: { limit: number; before?: number }): MaybePromise<PipeLogRow[]>`: newest first; `before` is an entry id.
  - `DataStore.deletePipeLog(pipeId: string): MaybePromise<void>`
  - `DataStore.supportsPipeLog: boolean` (true for SQLite and sql.js, false for DynamoDB, whose log methods are no-ops returning `[]`).

- [ ] **Step 1: Write the failing tests** (`pipe-store.test.ts`, SQLite and sql.js both, via `describe.each`)
  - `existing pipes read back as incoming with no test actions`: create the old `pipes` table without the new columns, insert a row, run `initializeSchema`, expect `direction === 'incoming'`, `test_actions === '[]'`.
  - `an outgoing pipe keeps its direction and test actions`.
  - `the log returns newest first, pages with before, and keeps 500 per pipe`: insert 502 entries for `p1` and 3 for `p2`; expect 500 for `p1` with the first two gone, 3 for `p2`; `listPipeLog('p1', { limit: 10, before: <id of 10th> })` returns the next 10.
  - `deletePipeLog removes only that pipe's entries`.
- [ ] **Step 2: Run** `npx vitest run src/database/pipe-store.test.ts`. Expected: FAIL (no `direction`, no `insertPipeLog`).
- [ ] **Step 3: Implement.** Columns via the existing `try { ALTER TABLE ... } catch` pattern in `schema.ts`; `pipe_log` table with `id INTEGER PRIMARY KEY AUTOINCREMENT`, index on `(pipe_id, id)`. Mirror in `schema-sqljs.ts`. DynamoDB: carry `direction`/`test_actions` on the item, log methods no-op, `supportsPipeLog = false`.
- [ ] **Step 4: Run** the test file, then `npx tsc --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `git commit -m "Pipes store: direction, test actions, per-pipe log"`

### Task 2: Outgoing actions and the gate program

**Files:**
- Create: `src/gateway/pipes-outgoing.ts`
- Test: `src/gateway/pipes-outgoing.test.ts`

**Interfaces:**
- Consumes: the vm pattern of `runPipeProgram` in `src/gateway/pipes.ts:183` (timeout race, `.catch` on the running promise, silent console).
- Produces:
  - `export const OUTGOING_SOURCES = ['gmail', 'google_calendar'] as const`
  - `export const ACTION_TYPES: Record<'gmail' | 'google_calendar', readonly string[]>` with the values in Global Constraints.
  - `export type OutgoingAction = { type: string; data: Record<string, unknown> }`
  - `export function normalizeAction(source: string, input: unknown): { ok: true; action: OutgoingAction } | { ok: false; message: string }`. Per type it keeps only these fields, all strings except as noted:
    - `send_email`, `draft_email`: `to` (string[]), `subject`, `body`
    - `reply_email`: `to` (string[]), `subject`, `body`, `in_reply_to`
    - `create_event`: `title`, `body`, `location`, `start`, `end`, `timeZone`, `attendees` (string[])
    - `update_event`: `eventId`, `title`, `body`, `location`, `start`, `end`
    - `delete_event`: `eventId`
    
    `to` and `attendees` accept a string with commas or semicolons, an array of strings, or (attendees) `[{ email }]`. Each is trimmed, lowercased and reduced to the bare address when given as `Name <a@b>`. An entry that is not a plausible address, or empty `to` for email types, is an error. Any CR or LF in `to`, `subject`, `in_reply_to` or an address is an error.
  - `export function toConnectorData(action: OutgoingAction): Record<string, unknown>`: `to` joined with `", "`; `attendees` as `[{ email }]`; everything else as is.
  - `export type GateResult = { outcome: 'pass' } | { outcome: 'block'; reason: string } | { outcome: 'error'; message: string }`
  - `export async function runGateProgram(program: string, action: OutgoingAction, timeoutMs?: number): Promise<GateResult>`. `pass` and `block` are created per run and return objects tagged with a per-run `Symbol` kept outside the sandbox; any other return value is `{ outcome: 'error', message: 'The program must return pass() or block(reason).' }`. `block` reason is `String(reason).slice(0, 500)`, or `'Blocked by the pipe.'` when empty. No `ask` in scope.

- [ ] **Step 1: Write the failing tests**
  - `normalises recipients: "Alice <ALICE@ucsd.edu>; bob@ucsd.edu"` gives `to: ['alice@ucsd.edu', 'bob@ucsd.edu']`.
  - `drops fields the type does not have` (`cc`, `bcc`, `foo` gone from `send_email`).
  - `rejects CR or LF in subject, to and in_reply_to` (`subject: 'Hi\r\nBcc: x@evil.com'` gives `ok: false`).
  - `rejects an unknown type for the source` (`create_event` on gmail) and an unknown source.
  - `create_event attendees as [{ email }] become lowercased strings`, and `toConnectorData` turns them back into `[{ email }]`.
  - `pass and block`: the spec's example program (students list) passes `alice@ucsd.edu`, blocks `dean@ucsd.edu` with reason `'Not a lab student: dean@ucsd.edu'`.
  - `a forged pass is an error`: programs `return true;`, `return "pass";`, `return { outcome: 'pass' };`, `return;` each give `outcome: 'error'`.
  - `a pass object from another run does not count`: a program that stores `pass()` on a global and a second run returning it. Use a fresh context per run, so the second run errors.
  - `throws, never settles, and endless loop are errors` (timeout 300 ms in the test).
  - `ask, require, fetch, process and setTimeout are not defined`.
  - `the program gets a copy`: mutating `action.data.to` inside the program does not change the caller's object.
- [ ] **Step 2: Run** `npx vitest run src/gateway/pipes-outgoing.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the four exports above. The action enters the sandbox as a JSON string and is parsed inside, as `runPipeProgram` does with rows.
- [ ] **Step 4: Run** the test file. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Outgoing pipes: action normalisation and the gate program"`

### Task 3: Pipe log for both directions

**Files:**
- Create: `src/gateway/pipe-log.ts`
- Modify: `src/gateway/pipes.ts` (agent GET route logs; owner routes gain `GET /:id/log`; `deletePipe` deletes the log)
- Test: `src/gateway/pipes.test.ts` (new `describe('log')`)

**Interfaces:**
- Consumes: Task 1 store methods.
- Produces:
  - `export async function logIncomingRun(store: DataStore, pipe: PipeRow, caller: string, purpose: string, run: PipeRun): Promise<void>`. Outcome `ok` | `error`; summary `{ itemsFetched, itemsReturned, released: [{ source_item_id, title }] }` (title from `data.title ?? data.subject ?? data.summary`, cut to 200 characters), or `{ error }`.
  - `export async function logOutgoingCall(store: DataStore, pipe: PipeRow, caller: string, purpose: string, entry: { outcome: 'sent' | 'blocked' | 'failed' | 'error'; action: OutgoingAction | null; reason?: string; result?: unknown; duration_ms: number }): Promise<void>`. Summary is the full normalised action plus reason and result.
  - Owner route `GET /web/pipes/:id/log?limit=50&before=<id>` returns `{ ok: true, entries: Array<PipeLogRow & { summary: object }> }`; `limit` defaults to 50, at most 200.

- [ ] **Step 1: Write the failing tests**
  - `an agent run of an incoming pipe is logged with caller, purpose and the released titles, not bodies`.
  - `a failing incoming run is logged as error`.
  - `the panel preview is not logged` (`GET /web/pipes/:id/preview` adds no entry).
  - `the log is owner only` (agent token with `pipe:<id>` gets 401 on `/web/pipes/:id/log`).
  - `deleting a pipe deletes its log`.
- [ ] **Step 2: Run** `npx vitest run src/gateway/pipes.test.ts -t log`. Expected: FAIL.
- [ ] **Step 3: Implement** `pipe-log.ts` and wire `logIncomingRun` into `GET /agent/pipes/:id` after the existing audit insert.
- [ ] **Step 4: Run** `npx vitest run src/gateway/pipes.test.ts`. Expected: PASS (existing pipe tests too).
- [ ] **Step 5: Commit** `git commit -m "Pipes: a log for every agent call"`

### Task 4: Agent route for outgoing pipes

**Files:**
- Modify: `src/gateway/pipes.ts` (`createPipeAgentRoutes`, `describePipe`, `describePipeForAgent`)
- Test: `src/gateway/pipes-outgoing-routes.test.ts` (new; reuse the setup pattern of `src/gateway/pipes.test.ts:260-308` with a stand-in Gmail connector whose `executeAction` records calls and can be told to throw or return `success: false`)

**Interfaces:**
- Consumes: `normalizeAction`, `toConnectorData`, `runGateProgram` (Task 2); `logOutgoingCall` (Task 3).
- Produces:
  - `POST /agent/pipes/:id` body `{ action: { type, data }, purpose }`. Responses:
    - 200 `{ ok: true, outcome: 'sent', result: { message, ...resultData } }`
    - 422 `{ ok: false, outcome: 'blocked', reason }`
    - 422 `{ ok: false, outcome: 'blocked', reason: 'The pipe failed; the action was not carried out.' }` on a program error (the owner, calling as owner, gets the real message)
    - 502 `{ ok: false, outcome: 'failed', reason }` when the connector throws or returns `success: false`
    - 400 invalid body or `normalizeAction` error (not logged; nothing ran)
    - 403 without `pipe:<id>`, 404 unknown id (permission checked first, as for GET), 409 `PIPE_OFF`, 400 `SOURCE_NOT_CONNECTED`
  - `GET /agent/pipes/:id` on an outgoing pipe and `POST` on an incoming one: 405 `{ ok: false, error: { code: 'WRONG_DIRECTION', message } }`.
  - `describePipe` and `describePipeForAgent` include `direction`; `GET /agent/pipes` lists both kinds.

- [ ] **Step 1: Write the failing tests**
  - `a passing email is sent once, with exactly the normalised fields, and logged as sent`.
  - `a blocked email is not sent; the agent gets the program's reason; logged as blocked`.
  - `a program error blocks, hides the message from an agent, shows it to the owner, and is logged as error with the message`.
  - `the connector throwing or returning success false is failed, logged, and not reported as sent` (Review Focus 4).
  - `a switched-off pipe sends nothing and is 409` (Review Focus 5); `the version read at the start decides`: start a call whose program awaits a promise the test controls, update the program in the store meanwhile, release it, expect the original verdict.
  - `header injection is a 400 and nothing is logged or sent` (Review Focus 1, end to end).
  - `wrong direction is 405 both ways`.
  - `permission: an agent without pipe:<id> is 403; having propose or pull gmail does not help`.
  - `the list shows direction`.
- [ ] **Step 2: Run** `npx vitest run src/gateway/pipes-outgoing-routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the route: read the pipe once, check permission, direction, enabled, connection; normalise; run gate; on pass call `connector.executeAction(action.type, toConnectorData(action))`; log; also keep the existing audit entry (`pipe_run` with `direction: 'outgoing'`, outcome).
- [ ] **Step 4: Run** the new file and `npx vitest run src/gateway/pipes.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Outgoing pipes: the agent route, carried out at once when the program passes"`

### Task 5: Building outgoing pipes: save, test actions, on/off rules, chat

**Files:**
- Modify: `src/gateway/pipes.ts` (`SavePipeInput`, `savePipe`, owner routes), `src/gateway/chat/routes.ts` (`save_pipe` tool schema, `PIPE_CONTRACT`, `pageContext`)
- Test: `src/gateway/pipes-outgoing-routes.test.ts` (`describe('building')`)

**Interfaces:**
- Consumes: Tasks 1, 2.
- Produces:
  - `SavePipeInput` gains `direction?: unknown` and `examples?: unknown` (list of `{ type, data, expect: 'pass' | 'block' }`).
  - `savePipe` for outgoing: source must be in `OUTGOING_SOURCES`; `query` ignored; direction immutable (error like the source rule); stores `test_actions` = valid `examples` (normalised; invalid ones reported back, not stored) merged with earlier ones, newest first, at most 20; test-runs the program over stored test actions plus the last 10 agent actions from the log (caller other than `owner`, entries with an action). Saves only if no run is `error`. A block is fine. Result `test: [{ type, to_or_title, expect, outcome, reason }]`. Always `enabled: 0` after an outgoing save; the result says `"Saved and switched off. The owner switches it on in the Pipes panel."`. Refused with a clear error when `store.supportsPipeLog` is false.
  - `savePipe` called from chat ignores `enabled: true` for outgoing pipes (the tool schema documents it).
  - Owner route `POST /web/pipes/:id/test` re-runs the stored test actions and the last 10 agent actions; returns `{ ok: true, results: [...] }` in the same shape; never executes, never logs.
  - The panel's on/off still uses `PUT /web/pipes/:id { enabled }`; for outgoing it is the only way to enable.
  - `PIPE_CONTRACT` gains the outgoing contract: `action`, `pass()`, `block(reason)`, no `ask`, failing closed, the action types and normalised fields from Task 2, `examples` with cases that should pass and should block from the owner's words, description says exactly what may go out, and that a save switches the pipe off.
  - `pageContext` for a selected outgoing pipe includes its test actions. `ChatPage` gains `newKind?: 'incoming' | 'outgoing'`, read from `POST /web/chat`; with no pipe selected it tells the model which kind to create.

- [ ] **Step 1: Write the failing tests**
  - `a new outgoing pipe is saved off, with its examples, and the test results come back`.
  - `editing a live outgoing pipe saves it and switches it off`.
  - `the chat cannot switch an outgoing pipe on` (save with `enabled: true` stays 0).
  - `a program that errors on a test action is not saved; a block is fine`.
  - `direction cannot change; gmail only for outgoing on gmail and calendar; github refused`.
  - `test runs never call the connector and add no log entry`.
  - `the last 10 agent actions are included in the test run, owner calls are not`.
  - `refused on a store without a log` (stub `supportsPipeLog = false`).
  - `the chat is told the outgoing contract` (system prompt contains `pass()` and `block(`).
- [ ] **Step 2: Run** `npx vitest run src/gateway/pipes-outgoing-routes.test.ts -t building`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/gateway`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Outgoing pipes: built in chat, tested without sending, switched on by the owner"`

### Task 6: Remove proposals by agents and the chat's write tools

**Files:**
- Modify: `src/gateway/app-api.ts` (remove `/propose`), `src/gateway/agents.ts` (`normalizePermissions` drops `propose:`; startup migration), `src/gateway/server.ts` or `src/index.ts` (run the migration once at start), `src/gateway/chat/routes.ts` (remove `draft_email`, `send_email`, both `create_calendar_event` tools and their handlers; adjust `buildSystemPrompt` wording)
- Test: `src/gateway/agents.test.ts`, `src/gateway/chat/*.test.ts` as affected; new `src/gateway/migrate-proposals.test.ts`

**Interfaces:**
- Produces:
  - `export async function retireProposals(store: DataStore): Promise<{ agentsChanged: number; proposalsRejected: number }>` in `src/gateway/agents.ts`: removes `propose:*` from every agent (audit `agent_updated` with `reason: 'propose permissions retired'`), and rejects pending staging rows that have an `action_proposed` audit entry (status `rejected`, audit `action_rejected` with `by: 'migration'`). Idempotent.
  - `normalizePermissions` accepts only `pull:<source>` and `pipe:<id>`.

- [ ] **Step 1: Write the failing tests**
  - `POST /agent/propose is 404`.
  - `a join link or agent update with propose:gmail is refused 400`.
  - `retireProposals removes propose grants, rejects agent-proposed pending actions, leaves SMS staging alone, and is idempotent`.
  - `the chat no longer offers draft_email, send_email or create_calendar_event` (tool list from a chat request to the stand-in provider).
- [ ] **Step 2: Run** the affected files. Expected: FAIL.
- [ ] **Step 3: Implement**, and delete or rewrite tests that exercised the removed paths (`src/query-hub.test.ts` propose case moves to Task 7).
- [ ] **Step 4: Run** `npx tsc && npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `git commit -m "Agents act only through outgoing pipes; the hub's chat no longer sends"`

### Task 7: query-hub and the agent template

**Files:**
- Modify: `bin/query-hub.mjs`, `src/query-hub.test.ts`
- Modify (other repo): `~/aismith/Lab-AI-Infra/smithagent/bin/query-hub.mjs` (copy of the hub's), `~/aismith/Lab-AI-Infra/smithagent/template/hub.md`, `~/aismith/Lab-AI-Infra/smithagent/test/*.mjs` if they mention propose

**Interfaces:**
- Produces:
  - `query-hub pipe <id> --action '<json>' --purpose '<why>'` POSTs `{ action, purpose }`; without `--action` it is the GET it is today. `--action` must parse as JSON with a string `type` and object `data`, else a usage error before any request.
  - `query-hub propose` removed; running it prints `propose was removed: act through an outgoing pipe (query-hub pipes).` and exits 1.
  - `query-hub pipes` output includes `direction`.
  - `hub.md`: reading through incoming pipes or pull; acting through outgoing pipes your owner gave you; a passed action is carried out at once, so be sure before calling; a blocked action is final, do not retry it with changes meant to get around the pipe; tell your owner what you sent.

- [ ] **Step 1: Write the failing tests** in `src/query-hub.test.ts`: `pipe --action sends through an outgoing pipe and the token stays out of the output`; `a blocked action exits non-zero and prints the reason`; `bad --action JSON is a usage error and makes no request`; `propose explains it was removed`; `pipes shows direction`.
- [ ] **Step 2: Run** `npx vitest run src/query-hub.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `bin/query-hub.mjs`; copy the file to Lab-AI-Infra; rewrite the acting section of `hub.md`.
- [ ] **Step 4: Run** `npx vitest run src/query-hub.test.ts` here and `node --test smithagent/test/` in `~/aismith/Lab-AI-Infra`. Expected: PASS in both.
- [ ] **Step 5: Commit** in each repo: `git commit -m "query-hub: act through outgoing pipes; propose removed"` (PersonalDataHub) and `git commit -m "smithagent: agents act through outgoing pipes"` (Lab-AI-Infra). Do not push.

### Task 8: Desktop Pipes page and agent settings

**Files:**
- Modify: `src/gateway/gui/frontend/js/renderWorkbench.js` (pipe list, new-pipe kind, outgoing panel, Log tab), `src/gateway/gui/frontend/js/main.js` (state, `runSelectedPipe` dispatch, `testSelectedPipe`, `loadPipeLog`, new-pipe kind), `src/gateway/gui/frontend/js/renderSettingsTab.js` (grouped ticks, no propose), `packages/ui/src/components/AgentsForm.tsx` (remove propose ticks only)
- Test: manual in the browser against a scratch hub (see Step 2); `npx tsc && npm test` for regressions

**Interfaces:**
- Consumes: `GET /agent/pipes` (with `direction`), `POST /web/pipes/:id/test`, `GET /web/pipes/:id/log`, `PUT /web/pipes/:id`.
- Produces (page behaviour, per spec "The panel"):
  - List rows show an `Incoming` or `Outgoing` tag.
  - "New pipe" shows two choices, Incoming ("what agents may read") and Outgoing ("what agents may do"); the chat is told which (`page: 'pipes'`, `focusId` absent, new field `newKind`).
  - Outgoing panel: name, description, source, on/off switch (when off: "Off. Review the test actions, then switch it on."), "Test actions" list (✓ passed / ✗ blocked, type, recipient or title, reason) with Run again, `POST` API line, Log, Show program, Delete.
  - Log tab, both kinds: newest first, time, agent, purpose, outcome; click to expand the summary (outgoing: to, subject, body or event fields, reason, result; incoming: counts and released titles); "Load older" uses `before`.
  - Settings → Agents: "Can read" (pull per source, incoming pipes) and "Can act through" (outgoing pipes); no propose ticks; default ticks on a new link are `pull:<connected sources>` only.

- [ ] **Step 1: Implement**, then `node scripts/build-frontend.mjs && npx tsc && npm test`. Expected: page generated, all tests pass.
- [ ] **Step 2: Check in the browser** with a scratch hub on port 3999 (as in the earlier session: temp database, stand-in Gmail connector that records sends): create an outgoing pipe through the panel and chat stub, see it saved off, switch on, POST an action as an agent, see it in the Log tab as sent, edit it, see it switched off. Expected: each state as described; no horizontal scroll at 1500 px and at 1000 px.
- [ ] **Step 3: Commit** `git commit -m "Pipes page: outgoing pipes, test actions and logs"`

### Task 9: Restart the owner's hub

- [ ] **Step 1:** `kill $(cat ~/.pdh/new-hub.pid)`; from `~/aismith/PersonalDataHub` run `nohup node /Users/haojianjin/orca/PersonalDataHub/dist/index.js > ~/.pdh/new-hub.log 2>&1 &` and write the pid to `~/.pdh/new-hub.pid`.
- [ ] **Step 2:** `curl -s http://127.0.0.1:3000/health` returns `{"ok":true,...}`; the hub log shows the `retireProposals` result line; `GET /agent/pipes` as owner lists existing pipes with `direction: "incoming"`.
