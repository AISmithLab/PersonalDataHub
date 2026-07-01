# Conversational Programming Engine Plan

## Goal

Let the user chat with the AI agent and have it write JavaScript code that executes immediately on the device — in the same Node.js process that runs the Hono server. The agent can iterate on errors, inspect outputs, and chain multiple code calls within a single conversation turn.

---

## Current State

- `runAgentLoop` in `src/gateway/chat/routes.ts` drives all chat interactions and supports tool calls.
- All tools that write data (`send_email`, `send_sms`, `create_calendar_event`) are **staged** — they queue a pending action that the user must explicitly approve before anything happens.
- There is no way for the agent to execute arbitrary code or inspect runtime state beyond the fixed connector tools.
- The device runs Node.js via `nodejs-mobile-capacitor` inside the Capacitor Android app; `child_process.fork/spawn` is unreliable in this environment, but the `vm` module works.

---

## Design Decisions

### Auto-execute, not staged

`run_code` departs from the staging convention intentionally. Staging breaks the agentic loop: if the agent can't see the output of its own code, it can't iterate on errors or refine its approach. Defenses instead:

- 30-second wall-clock timeout via `Promise.race` + `AbortController` (important: `vm`'s `timeout` option only kills **synchronous** code; `await fetch(...)` ignores it — `Promise.race` is the only reliable async kill).
- Output capped at 10 KB (truncated with a notice if exceeded).
- Every execution logged to the audit log (`event: 'code_executed'`) with the code, duration, and whether it errored.

The user is chatting in the app on their own device and explicitly asked for code execution. This is the same trust level as the existing chat.

### Sandbox scope

Code runs in a `vm.createContext` with:
- `console` — captured, output returned to the agent
- `fetch` — native Node.js fetch (DNS patch in `android.ts` applies)
- `require` — allows `fs`, `path`, `crypto`, `yaml`, and any package in the app's `node_modules`
- `Buffer`, `URL`, `URLSearchParams`, `setTimeout`, `clearTimeout`, `AbortController`
- `__dataDir` — absolute path to the app's data directory (the same `pdh-data/` that holds the DB and config)

`require` gives full fs/net access by design — this is the user's own device. If the agent writes a file, it can read it back in the next call.

### State between calls

Each `run_code` invocation creates a fresh `vm` context. There is no shared in-memory state between tool calls. Persistence must go through files or the database. The agent should be aware of this (system prompt hint).

### Language: JavaScript only (MVP)

TypeScript transpilation at runtime would require esbuild or ts-node in the mobile bundle, adding significant complexity and size. The agent generates plain JavaScript. TypeScript support is Out of Scope for this round.

---

## Changes

### 1. `src/gateway/code-runner/runner.ts` (new file)

Core execution engine:

```ts
export interface RunResult {
  output: string;
  error?: string;
  duration: number;
  truncated: boolean;
}

export async function runCode(code: string, dataDir: string): Promise<RunResult>
```

Implementation:
1. Capture `console.log/warn/error/info` to a string buffer. Use `util.format(...args)` to join multiple arguments the same way Node's built-in console does.
2. Wrap `code` in an async IIFE so `await` works at the top level:
   ```js
   (async () => { <user code here> })()
   ```
3. Create a `vm.createContext` with the sandbox globals (see above, plus `require` via `createRequire`).
4. **Dual timeout — both layers are required:**
   - `vm.runInContext(wrappedCode, ctx, { timeout: 30000 })` — kills **synchronous** hangs (e.g., `while(true){}`). Without this, a sync infinite loop blocks the Node.js event loop before any Promise can settle.
   - `Promise.race([vmPromise, timeoutReject(30000)])` — kills **async** hangs (e.g., `await fetch(neverResolves)`). The `vm` timeout doesn't help here because the code has already yielded.
   Both are needed; either alone leaves one class of hang uncovered.
5. Collect output, truncate at 10 KB with a notice, return `RunResult`.
6. Catch all errors and return them in `error` (never throw — the agent needs to see the error text to fix its code).

### 2. `src/gateway/chat/routes.ts`

#### 2a. Add `run_code` to `buildTools()`

```ts
tools.push({
  type: 'function',
  function: {
    name: 'run_code',
    description: `Execute JavaScript code in the local Node.js runtime on the user's device.
Use this to perform computations, read/write files, fetch URLs, query the database, or process data.
Code runs with access to: fetch, require (fs, path, crypto, etc.), Buffer, URL, __dataDir (app data path).
Await is supported at the top level. Each call starts with a fresh context — use files for persistence.
Return values are not automatically captured; use console.log() to emit output.`,
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript code to execute. Use console.log() to produce output.',
        },
        description: {
          type: 'string',
          description: 'One-line description of what this code does (shown in the audit log).',
        },
      },
      required: ['code'],
    },
  },
});
```

#### 2b. Add handler in `executeTool()`

```ts
case 'run_code': {
  const code = String(input.code ?? '').trim();
  if (!code) return JSON.stringify({ error: 'code is required' });

  // PDH_DATA_DIR is set by android.ts at startup (see §6 below).
  // Fallback is for desktop/CI runs only.
  const dataDir = process.env.PDH_DATA_DIR
    ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'pdh-data');

  const { runCode } = await import('./code-runner/runner.js');
  const result = await runCode(code, dataDir);

  await deps.store.insertAuditEntry({
    timestamp: new Date().toISOString(),
    event: 'code_executed',
    source: null,
    details: JSON.stringify({
      description: input.description ?? '',
      code: code.slice(0, 500),
      duration: result.duration,
      error: result.error ?? null,
    }),
  });

  return JSON.stringify({
    output: result.output || '(no output)',
    ...(result.error ? { error: result.error } : {}),
    duration_ms: result.duration,
    ...(result.truncated ? { note: 'Output truncated at 10 KB' } : {}),
  });
}
```

#### 2c. Update system prompt (`buildSystemPrompt`)

Add one paragraph describing code execution:

```
Code execution: You can run JavaScript on this device with run_code(). Use it freely to compute, transform data, read files, or fetch URLs. Each call has a fresh context — write files to persist data between calls. Always console.log() values you want to see; return values are not captured.
```

### 3. `POST /api/code/run` (in `src/gateway/chat/routes.ts`)

**This endpoint is the user-facing "Run" button path only.** It is _not_ what the agent uses — the agent calls `run_code` as a tool inside `executeTool()`, which never touches this HTTP route. Keeping the two paths distinct prevents confusion during code review.

A session-protected HTTP endpoint so the frontend can trigger code execution directly (e.g., for a "Run" button on a code block the agent emitted as plain markdown in its reply):

```
POST /api/code/run
Body: { code: string }
Response: { ok: true, output: string, error?: string, duration_ms: number, truncated: boolean }
```

This endpoint calls `runCode()` and inserts the same audit entry.

### 4. `src/android.ts` — export `PDH_DATA_DIR`

`android.ts` already computes `dataDir` but only exports `PDH_DB_PATH` and `PDH_CONFIG_PATH`. The runner needs a stable path to the data directory. Add one line immediately after `dataDir` is set:

```ts
process.env.PDH_DATA_DIR = dataDir;
```

This is the single source of truth. The fallback in `executeTool` and the `/api/code/run` endpoint is for desktop/CI runs where `android.ts` never executes.

### 5. Frontend (`www/index.html` / chat UI)

#### 5a. Code block rendering

The chat UI currently renders AI messages as plain text. Detect fenced code blocks in the assistant's reply and:
- Render them with a monospace `<pre><code>` block.
- Add a "Run" button (visible only when `window.AndroidSms` or `navigator.userAgent` indicates mobile, or always).
- On tap, `POST /api/code/run` with the block's content, show a spinner, then append output below the block in a `<pre class="code-output">` element.

#### 5b. Tool-call output display

When the agent calls `run_code` as a tool, the tool result (output/error) is part of the conversation but not directly shown in the current UI. Surface it by:
- Parsing streamed tool-call results and inserting a collapsible "Code ran" disclosure (code + output) between the assistant thinking turn and its final reply.

This UI work is lighter-weight than it sounds: the chat message model already passes `toolsUsed` back to the frontend. Extend it to pass `toolOutputs: { name, input, output }[]` and render them as collapsed `<details>` blocks.

### 6. `src/gateway/chat/routes.ts` — return type update

Extend `runAgentLoop` to return `toolOutputs`:

```ts
return { reply, toolsUsed, stagedActionIds, toolOutputs };
```

Where `toolOutputs` is `{ name: string; input: Record<string, unknown>; output: string }[]`. The frontend uses this to render what the agent did.

---

## Data Flow

```
User: "Fetch my current public IP and save it to a note"
       │
POST /api/chat { messages }
       │
runAgentLoop — round 1
  AI decides to call run_code:
    code: `
      const res = await fetch('https://api.ipify.org?format=json');
      const data = await res.json();
      console.log('IP:', data.ip);
    `
       │
executeTool('run_code', { code }) → runCode(code, dataDir)
  └── vm.createContext + Promise.race(exec, 30s timeout)
  └── captures console output: "IP: 203.0.113.5"
  └── returns RunResult { output: "IP: 203.0.113.5", duration: 312 }
  └── audit log: code_executed { description, code[:500], duration, error: null }
       │
Tool result returned to AI: { output: "IP: 203.0.113.5", duration_ms: 312 }
       │
runAgentLoop — round 2
  AI: "Your current public IP is 203.0.113.5."
       │
Response to frontend: { reply, toolsUsed: ['run_code'], toolOutputs: [...] }
       │
Chat UI renders:
  • Agent bubble with final reply text
  • Collapsed <details>: "Ran code (312ms)" → shows code + output
```

---

## API endpoint summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/code/run` | Session | Direct code execution from the frontend |

All other changes are to existing files.

---

## Files Changed

| File | Change |
|------|--------|
| `src/gateway/code-runner/runner.ts` | New — core execution engine |
| `src/gateway/chat/routes.ts` | Add `run_code` tool, executor, system prompt update, `/api/code/run` endpoint (user path), `toolOutputs` in return |
| `src/android.ts` | Add `process.env.PDH_DATA_DIR = dataDir` so the runner has a stable data path on device |
| `www/index.html` | Code block rendering, "Run" button, tool-call disclosure UI |

---

## Out of Scope

- TypeScript transpilation at runtime
- Persistent execution context / REPL state across turns
- File save/load shortcuts (`save_script`, `run_saved_script`)
- Streaming execution output (output is returned after the code finishes)
- Sandboxing beyond the `vm` context and timeout (no seccomp, no chroot — user's device)
- Android-native APIs beyond what's accessible via Node.js + `fetch`
