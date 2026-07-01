# Auto-Reply Context Enhancement Plan

## Goal

Give the SMS auto-reply full situational awareness: SMS conversation history, Calendar, and Email. Allow it to write calendar events autonomously (no staging/approval).

## Current State

- `/sms/auto-reply` does a single one-shot AI call with a minimal system prompt
- No tools, no calendar/email context, no SMS history
- `runAgentLoop` (used by the chat tab) already has full tool support but is not used here
- The JS polling sends only `{ from, body }` — no conversation history

---

## Changes

### 1. `src/config/schema.ts`

Add `maxToolRounds` to `autoReplySchema`:

```ts
const autoReplySchema = z.object({
  enabled: z.boolean().default(false),
  maxToolRounds: z.number().int().min(1).max(10).default(3),
});
```

Exposed in Settings UI so the user can tune speed vs. depth (default 3).

---

### 2. `src/gateway/chat/routes.ts`

#### 2a. New `buildAutoReplyTools(deps)`

Same as `buildTools` but excludes tools that don't make sense in an auto-reply:
- ❌ `send_sms` — we're generating the reply text directly
- ❌ `draft_email` / `send_email` — out of scope
- ✅ `read_emails`
- ✅ `read_calendar_events`
- ✅ `create_calendar_event`
- ✅ `save_memory` / `update_memory` / `delete_memory`

#### 2b. New `executeAutoReplyTool(deps, name, input)`

Same logic as `executeTool` with one key difference:

`create_calendar_event` **executes directly** via `connector.executeAction('create_event', input)` instead of staging for review. All other tools are identical to `executeTool`.

#### 2c. New `runAutoReplyLoop(deps, from, smsBody, history, maxRounds)`

Replace the one-shot `client.chat.completions.create` call in `/sms/auto-reply` with a proper agent loop:

**System prompt:**
```
You are an AI SMS auto-reply assistant on the user's Android phone. Today is {date}.

Reply concisely via SMS (1-3 sentences). Do not identify yourself as AI unless asked.
Reply with just the message text — no quotes, no labels, no preamble.

Use your tools proactively:
- Check the calendar before replying to anything time/scheduling related
- Check email for relevant threads if the context is unclear
- Create calendar events directly if the sender proposes a time or meeting
- Save new facts about this contact to memory if they share something relevant

{memories block}

Recent SMS conversation with {from}:
{history block}
```

**Loop:** runs up to `maxRounds` tool call rounds, then returns the final text reply.

#### 2d. Update `/sms/auto-reply` endpoint

- Accept `history: { address, body, date, type }[]` in the request body
- Read `maxToolRounds` from `deps.config.autoReply?.maxToolRounds ?? 3`
- Call `runAutoReplyLoop` instead of the one-shot call

---

### 3. `src/gateway/gui/routes.ts`

In the auto-reply polling loop, when a new message is detected:

1. Filter the already-fetched `messages` array for exchanges with `msg.address` (both sent `type=2` and received `type=1`)
2. Take the last 10 by date
3. Include as `history` in the `/sms/auto-reply` request body

```js
var history = messages
  .filter(function(m) { return m.address === msg.address; })
  .sort(function(a, b) { return a.date - b.date; })
  .slice(-10);

fetch('/sms/auto-reply', {
  body: JSON.stringify({ from: msg.address, body: msg.body, history: history }),
  ...
})
```

---

## Settings UI

Add a `maxToolRounds` slider/input to the SMS Auto-Reply section in Settings (range 1–5, default 3). Persisted to `hub-config.yaml` via `POST /api/settings/auto-reply`.

Update `POST /api/settings/auto-reply` to also accept and persist `maxToolRounds`.

---

## Data Flow (after changes)

```
Govind sends SMS
       │
JS polling detects new message
       │
Fetches last 10 SMS with Govind from inbox
       │
POST /sms/auto-reply { from, body, history }
       │
runAutoReplyLoop
  ├─ round 1: AI decides to check calendar → read_calendar_events
  ├─ round 2: AI decides to create event  → create_calendar_event (direct, no staging)
  └─ round 3: AI generates final SMS reply
       │
reply text returned in response
       │
AndroidSms.sendMessage(to, reply)
```

---

## Out of Scope

- Reading SMS history from `SmsReceiver` path (background) — it sends `{ from, body }` only; history requires the JS path which has access to the inbox
- GitHub tools — not relevant for SMS conversation context
