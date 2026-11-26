# Outgoing pipes

Date: 2026-11-26. Status: draft for Haojian's review.

## Intent

Pipes today carry data one way: from a source, through a program, to agents. Haojian wants the other direction as well. An agent that wants to act with his account (send an email, create a draft, add an event) goes through an **outgoing pipe**: a program that decides whether the action may go out. His example: "the agents can only write emails to a selected subset of students."

What passes is carried out at once. There is no approval step: "if it's a tricky case, i will not build pipes." Instead he reviews afterwards, through a log kept for every pipe, incoming and outgoing.

This replaces the per-source review panel removed from the Gmail and Calendar pages, and puts "what agents may do" in the same place as "what agents may see".

## Goals

- Two kinds of pipe: incoming (today's) and outgoing.
- An outgoing pipe is built and revised in the Pipes chat, like an incoming one, and is a program.
- A passing action is executed immediately; a blocked one is not, and the agent is told why.
- Every pipe has a log Haojian can read in its panel: each call, who made it, what went in, what came out or what was sent.
- Agents act only through outgoing pipes.

## Non-goals

- Holding an action for approval. A pipe passes or blocks.
- Changing an action inside the pipe (adding a signature, turning a send into a draft). The program decides; it does not rewrite. (My call: a gate that also edits is harder to read in the log. Can be added later.)
- Undo. A sent email stays sent.
- Rate limits per pipe. (Noted under open points.)

## Anti-goals

- An action going out that no pipe passed.
- A pipe that passes or blocks differently from one call to the next for the same action. Hence no `ask()` in outgoing programs.
- Testing a pipe by sending real mail.

## Approaches

1. **Picked: a program, like incoming pipes.** The chat writes a program that sees the action and returns pass or block with a reason. Same runner, chat flow and panel as incoming pipes. Haojian: "i mean program. i will ask llm to generate more complex programs."
2. Rules: the chat fills a fixed form (allowed actions, recipients, words). Easier to verify at a glance; cannot express anything outside the form, and would be a second model beside incoming pipes. Rejected.
3. Rules plus an optional program. Two places to look when asking why something went out. Rejected.

## Design

### The pipe

The `pipes` table gains `direction TEXT NOT NULL DEFAULT 'incoming'` (`incoming` | `outgoing`). Existing pipes become incoming. Like `source`, direction cannot change after creation, because an agent's `pipe:<id>` grant must not turn from a read into a write.

An outgoing pipe has `name`, `description`, `source` (gmail or google_calendar), `program`, `enabled`. `query` is unused.

Which actions a pipe may carry is decided by its program, from the action's `type`. The hub only accepts the action types the source's connector knows:

- gmail: `send_email`, `reply_email`, `draft_email`
- google_calendar: `create_event`, `update_event`, `delete_event`

### The program

The body of an async function. In scope:

- `action`: `{ type, data }`, a copy of what the agent sent. For email, `data` has `to`, `subject`, `body`, and for a reply `in_reply_to`.
- `pass()` and `block(reason)`: what the program returns.

Nothing else: no `ask`, no network, no files, no timers (the existing vm sandbox, with `ask` left out). A program that throws, times out or returns anything other than `pass()`/`block(...)` blocks the action, and the reason says so. Failing closed is the point.

`to` may be a string with several addresses; the hub normalises it to an array of lowercased addresses before the program sees it, so a list check cannot be bypassed by case or by `"a@x, b@y"`. (My call.)

Example, from Haojian's request:

```js
const students = ["alice@ucsd.edu", "bob@ucsd.edu"];
if (action.type !== "send_email" && action.type !== "draft_email") return block("Only emails and drafts.");
const outside = action.data.to.filter((r) => !students.includes(r));
if (outside.length) return block("Not a lab student: " + outside.join(", "));
return pass();
```

### Agent route

`POST /agent/pipes/:id` with `{ action: { type, data }, purpose }`. Needs `pipe:<id>`; the pipe must be outgoing and on.

1. Validate the body; unknown `type` for the source is 400.
2. Run the program (timeout as today).
3. Pass: execute with the connector, log, return `{ ok: true, outcome: "sent", result }` (result: the connector's message and ids, such as a draft id).
4. Block: log, return 422 `{ ok: false, outcome: "blocked", reason }`. The reason is the program's own text, which Haojian controls; it is shown to the agent so it can correct itself.
5. Program error: as block, with reason "The pipe failed; the action was not carried out." for the agent; the real error goes to the log only (same rule as incoming pipes).
6. Execution error (Gmail refused): `{ ok: false, outcome: "failed", reason }`, logged.

`GET /agent/pipes/:id` on an outgoing pipe is 405, and `POST` on an incoming one is 405. `GET /agent/pipes` lists both kinds with `direction`, so an agent knows which it can write through.

### Removing raw proposals

- `propose:<source>` permissions and `POST /agent/propose` are removed. Agents act only through outgoing pipes.
- Existing grants of `propose:*` are dropped from every agent at startup (migration), with an audit entry per agent.
- Pending staged actions that agents proposed are rejected by the same migration, so none can still go out without a pipe. Agent proposals are told apart from the chat's by their `action_proposed` audit entry, whose caller is an agent name rather than `owner`/chat. (My call.)
- The staging table and `/web/staging/*` stay only for the phone's SMS auto-reply, which still stages `send_sms`. Nothing else writes to staging.
- `query-hub propose` is replaced by `query-hub pipe <id> --action '<json>' --purpose '<why>'` (a POST when `--action` is given). `smithagent/template/hub.md` is rewritten: you act through the outgoing pipes your owner gave you; a blocked action is final, do not try to get around it.

### Logs

New table `pipe_log`: `id`, `pipe_id`, `at`, `caller` (agent name or `owner`), `purpose`, `outcome` (incoming: `ok` | `error`; outgoing: `sent` | `blocked` | `failed` | `error`), `summary` (JSON: incoming counts and the released items' ids and titles; outgoing the action as checked, the reason, the connector result), `duration_ms`.

- Written on every agent call, both directions, and on Haojian's own calls through the agent routes (caller `owner`). Previews and test runs from the Pipes page are not logged here. The audit log keeps its entries as today.
- Kept: the newest 500 entries per pipe; older ones are deleted on insert. Outgoing entries keep the full action (recipient, subject, body), since what was sent is the point of the log. Incoming entries keep ids and titles of released items, not bodies: the source still has them. (My calls.)
- Deleting a pipe deletes its log.
- `GET /web/pipes/:id/log?limit=&before=`: owner only.

### Building an outgoing pipe in chat

- `save_pipe` gains `direction`. The chat is told the contract for outgoing programs (`action`, `pass`, `block`, no `ask`, fail closed) and to state in the description exactly what may go out.
- Testing never sends. Before saving, `save_pipe` runs the program against test actions and saves only if the program runs (a block is fine; an exception is not). Test actions are: the ones the model passes in `examples` (it is told to include cases that should pass and cases that should block, from Haojian's request), plus the last 10 real actions agents sent to this pipe, from the log.
- An outgoing pipe is created **off**. Haojian switches it on in the panel after looking at the test results. (My call, because a pass sends real mail.)
- Only Haojian switches an outgoing pipe on, from the panel. The chat's `save_pipe` cannot set `enabled: true` on an outgoing pipe. (My call.)
- Editing a live outgoing pipe: the chat may save the new version, and saving switches the pipe off. It goes live again only when Haojian switches it on in the panel ("can save. but need to manually deploy."). The panel says why it is off ("Changed: review the test results and switch it on"). Agents calling it meanwhile get `PIPE_OFF`.
- Test actions are kept with the pipe, in a new column `test_actions` (JSON list of `{ type, data, expect }`, at most 20), so "Run again" can replay them. Runs from the panel and from `save_pipe` never execute and are not written to the log; the log holds agent calls only, plus Haojian's own calls through the agent route, marked `owner`. "The last 10 real actions" means agent calls only. (My calls.)

### The panel

The Pipes page lists both kinds, each marked Incoming or Outgoing. "New pipe" asks which kind, or the chat infers it from the request; the panel shows which was chosen before the first save.

An outgoing pipe's panel:

```
Students only                              [ ] Available to agents
Agents may email or draft to the 6 students in my lab. Anything else is blocked.
Source: Gmail

Test actions                                   [Run again]
  ✓ passed   send_email  to alice@ucsd.edu   "Letter submitted"
  ✗ blocked  send_email  to dean@ucsd.edu    Not a lab student: dean@ucsd.edu
  ✓ passed   draft_email to bob@ucsd.edu     "Draft: your SOP"

API for agents    POST http://127.0.0.1:3000/agent/pipes/k7f3q2x2
[Log]  [Show program]                                  [Delete pipe]
```

The **Log** tab, for either kind, lists entries newest first: time, agent, purpose, outcome. Opening one shows its summary: for a sent email, the recipient, subject and body; for an incoming run, the items released.

### The hub's own chat

Decided by Haojian: "the own chat is only for pipe authoring." The chat in the hub's desktop page loses its write tools: `draft_email`, `send_email`, `create_calendar_event` (both definitions) and the staging they did. Read tools and the pipe and skill tools stay. My interpretation of scope: the phone's SMS auto-reply (`send_sms`, executed on the device) is not part of the desktop chat and is left as it is. With this, nothing in the hub sends except a passing outgoing pipe and the phone's SMS reply.

### Settings → Agents

Grant ticks are grouped: "Can read" (pull per source, incoming pipes) and "Can act through" (outgoing pipes). The propose ticks go.

## Constraints

- Sends are real and irreversible; every path by which an **agent** can make something go out must go through a pipe program and write a log entry before returning. Haojian's own chat does not act at all; see "The hub's own chat".
- The program runs in the same vm sandbox as incoming programs, with the same timeout, and without `ask`.
- SQLite and sql.js stores get the new columns and table. On DynamoDB, creating an outgoing pipe is refused with a clear error, since there is no log there; incoming pipes keep working without a log. (My call.)
- Desktop page `/` is the UI. The phone-shaped `/next` page is not changed.

## Open points


1. **A cap per pipe** (for example 20 sends a day) would limit damage from a runaway agent. Not asked for; proposed as a later addition.

## Left to the builder

- Exact wording of the chat contract and panel text.
- Log pagination size.
- How `examples` are shaped in the `save_pipe` tool schema.
