# Agent registration (joinhub)

Date: 2026-11-25. Status: awaiting approval.

Covers two repositories: PersonalDataHub (the hub) and `Lab-AI-Infra/smithagent` (the agent runtime). Supersedes the "Agent keys" part of `2026-11-24-api-redesign-design.md`.

## Intent

Agents should register with the hub the way they register with the lab's SmithLibrary: the owner makes a one-time join link in Settings, the agent redeems it, and the owner sees the agent in a list and can cut it off. The owner never copies a secret. This becomes part of the smithagent protocol, which gets two joins: `joinhub` and `joinlibrary`.

Decided by Haojian:

- The hub's join is its own, not wire-compatible with SmithLibrary's.
- smithagent has two joins, `joinhub` and `joinlibrary`.
- An agent is created first and takes tasks from its terminal. Either join can be added afterwards.
- An agent reaches the hub through a `query-hub` command, not MCP and not raw curl.
- Remove the hub's MCP server.

## Goals

- Settings → Agents in the hub: create a join link, list agents, change what an agent may do, revoke.
- A join handshake any client can perform with one HTTP call.
- Per-agent permissions enforced on every `/agent/*` call.
- `smithagent create`, `joinlibrary`, `joinhub`, and a `query-hub` client.
- The MCP server is gone from the hub.

## Non-goals

- Reaching a hub on another machine. The hub listens on `127.0.0.1`, so `joinhub` works only for an agent on the same machine as the hub.
- Delivering tasks to agents through the hub. Tasks come from the terminal or a library channel.
- Changes to SmithLibrary's gateway or its join.
- Pipes. When they are built, `query-hub` gains `pipes` and `pipe <id>` and a `pipes` permission.

## Anti-goals

- A token must never be shown in the hub's UI, printed into the agent's conversation, or stored anywhere but the agent's own directory (mode 0600) and, as a hash, the hub's database.
- An agent must not be able to widen its own permissions or mint links through the API. (An agent running as the same OS user as the hub can already read the hub's database and OAuth tokens directly; the setup guide's separate `personaldatahub` user is what closes that, and nothing here changes it.)

## Approaches

How a joined agent reaches the hub:

1. **Picked: a `query-hub` command** beside `query-library`. The token stays in a file the command reads; the agent template allows it with one line; pipes get an obvious home.
2. The hub's MCP server in the agent's `.mcp.json`. Rejected: needs the hub package on the agent's side and a per-agent config it does not have. Haojian: "remove the mcp."
3. curl from the agent's instructions. Rejected: the token would sit in the model's context and logs.

`query-hub` still goes through the hub's REST API. The hub is a separate process that holds the OAuth tokens; `/agent/*` is where the token check, permissions, quick filters, staging and audit happen.

## Part 1: the hub

### Data

`agent_keys` (added yesterday on this branch, never released) is replaced by two tables, in all three stores including DynamoDB:

`agents`: `id`, `name` (unique), `token_hash` (SHA-256 hex), `permissions` (JSON array), `created_at`, `last_used_at`.

`join_codes`: `code` (primary key, 24 random bytes hex), `permissions` (JSON array), `created_at`, `expires_at` (15 minutes), `used_at`.

Revoking deletes the agent row, which also frees its name. (My call; SmithLibrary keeps revoked rows and reserves names, but the hub has one owner and a short list.)

Tokens: `pdh_` + 32 random bytes base64url. They do not expire; the owner revokes. (My call. SmithLibrary's tokens expire because membership can lapse; here the owner is the only principal.)

### Permissions

| Permission | Allows |
|---|---|
| `pull:<source>` | `POST /agent/pull` for that source |
| `propose:<source>` | `POST /agent/propose` for that source |

Sources are `gmail`, `google_calendar`, `github`, `photo`. Propose is per source so that an agent given only GitHub cannot stage a Gmail send. (My call.)

`GET /agent/sources` lists only the sources the agent may pull. A call without the needed permission gets 403 `FORBIDDEN` naming the missing permission. The owner's own credential passes every check. New join links default to read and propose ticked for every connected source.

### Routes

```
POST   /web/agents/join-links    { permissions }  ->  { url, expires_at }       owner
GET    /web/agents               list: id, name, permissions, created_at, last_used_at   owner
PUT    /web/agents/:id           { permissions }                                owner
DELETE /web/agents/:id           revoke                                         owner

GET    /agent/join/:code         page for a person: what the link grants, and the command to run   no credential
POST   /agent/join               { code, name }  ->  token, once                no credential
GET    /agent/me                 the calling agent's name and permissions       agent
POST   /agent/leave              the calling agent deletes itself               agent
```

`url` is `<hub origin>/agent/join/<code>`.

`POST /agent/join` answers 201 with `{ ok, token, agent_id, agent_name, permissions, hub }`, where `hub` is the base URL to use from then on. Errors: 410 `GONE` (unknown, used, or expired code), 400 `INVALID_NAME`, 409 `NAME_TAKEN`. A failed join does not consume the code.

Names: `^[a-z0-9][a-z0-9-]{0,62}$`; `owner` is reserved. The agent supplies its own name, so the hub's list and audit log show the name the agent has locally.

The two join routes are the only `/agent` routes without a credential. Like the OAuth callback they are protected by a one-time value: 24 random bytes, single use, 15 minutes. Joins are written to the audit log (`agent_join_link_created`, `agent_joined`, `agent_revoked`, `agent_left`, `agent_permissions_changed`).

### Settings → Agents

Replaces "Agent Keys" in `packages/ui`.

```
‹ Back  Agents
Agents read your data and propose actions through this hub. Each one registers
with a join link and can be revoked on its own.

[ Add agent ]

haojian-agent7                                   last used 2 min ago
Gmail (read, propose) · Calendar (read)          [Edit]  [Revoke]

writer                                           never used
GitHub (read)                                    [Edit]  [Revoke]
```

"Add agent" opens:

```
What may this agent do?
              Read    Propose actions (you approve each one)
Gmail         [x]     [x]
Calendar      [x]     [ ]
GitHub        [ ]     [ ]
Photos        [ ]     [ ]

[ Create join link ]
```

then shows:

```
Join link, valid once, until 14:32
http://127.0.0.1:3000/agent/join/4f9c…                 [Copy]

On the machine where the agent runs:
  smithagent joinhub <agent> http://127.0.0.1:3000/agent/join/4f9c…
```

The list refreshes while this panel is open, so the owner sees the agent appear. "Edit" shows the same checkboxes.

On a phone hub (one that uses the device secret) the Agents section is hidden and both join routes answer 404. No smithagent can run there, and the last review removed signup on these hubs for the same reason: any local app could reach a credential-free route. (My call.)

Empty state: "No agents yet. Add one to let an agent use this hub."

### CLI

Haojian: keep `pdh`; "i will run pdh myself manually whenever needed." Agents do not start the hub.

- Kept as they are: `pdh init`, `start`, `stop`, `status`, `install-service`, `uninstall-service`, `reset`.
- Removed: `pdh mcp`, and `pdh key` (added yesterday on this branch). There is no `pdh join-link`; join links come only from Settings → Agents.
- `pdh init` no longer creates a key or prints one.
- `~/.pdh/config.json` stays, because `start`, `stop`, `reset` and `install-service` read `hubDir` from it so they work from any directory. It holds only `hubUrl` and `hubDir` again: no `apiKey`, and no agent reads it. (Correction to what I told Haojian: it cannot be deleted while `pdh` stays.)

### Removing MCP

Delete `src/ai/mcp/`, the `mcp` command, the `@modelcontextprotocol/sdk` dependency, and the MCP sections of `README.md` and `systemdesigns/`. Cursor and Windsurf users lose their integration; any agent that can run a shell command can use `query-hub` instead. `systemdesigns/architecture-design/skills-vs-mcp.md` is a historical note and stays.

`packages/personaldatahub` (the OpenClaw plugin) is not MCP and stays. It stops reading `~/.pdh/config.json`: it takes the hub address and token from its own settings, or from `query-hub`'s token file (`QUERY_HUB_CONFIG`, else `~/.pdh/agent.json`). (My call.)

`skills/email-assistant`, `skills/calendar-assistant` and `packages/personaldatahub/SKILL.md` switch from curl to `query-hub`, with a first step: if `query-hub me` fails, ask the owner for a join link from Settings → Agents and run `query-hub join <link> --name <name>`.

### Built, and changed after review (2026-11-25)

Part 1 is implemented on branch `pipes`. An independent review led to these changes:

- `query-hub join` reserves its token file before it spends the link, so a file that cannot be written no longer loses the token. It refuses to follow a symlink at that path.
- `query-hub` sends a join code only to this machine over http, or to any host over https, and scrubs the token from anything it prints.
- `/agent/pull` and `/agent/propose` reject a `source` that is not a plain string, and a body that is not a JSON object, with 400.
- DynamoDB: agent updates are conditional on the agent still existing (an update racing a revoke could otherwise revive the token), and names are reserved with their own item.

Known and not addressed:

- **First-run window on desktop.** Before the owner creates the account, any local program can call signup and become the owner, and could then mint join links. This predates registration but undermines it during that window. Closing it needs a setup code from `pdh init` that signup must present; Haojian to decide.
- DynamoDB looks agents up by id with a table scan on every agent call. Fine at a handful of agents.
- The sql.js and DynamoDB implementations of the new store methods have no automated tests; only SQLite does.
- (Fixed 2026-11-25.) The desktop page at `/` now has Settings → Agents too. Leaving it out was a wrong call: `/` is the desktop layout Haojian uses, and `/next` is the phone-shaped rewrite.

## Part 2: smithagent

Built 2026-11-25 on branch `joinhub` in `Lab-AI-Infra` (worktree `~/aismith/Lab-AI-Infra-joinhub`, not merged). As built it follows this part, with these specifics: the vendored client is `smithagent/bin/query-hub.mjs`, installed as `~/.smithagent/bin/query-hub.mjs` plus a `query-hub` wrapper; `template/library.md` and `template/hub.md` are the appended sections; `node --test smithagent/test/` covers the commands end to end with a fake gateway and a fake hub. `joinlibrary` against the real library gateway was not run.

In `Lab-AI-Infra/smithagent`. Other sessions commit to that repository; pull first and work on a branch.

### Commands

```
smithagent create <name> [--work <dir>]        a local agent with no connections
smithagent joinlibrary <agent> <library-url>   attach it to a SmithLibrary channel
smithagent joinhub <agent> <hub-url>           give it access to a PersonalDataHub
```

- `create` makes `~/.smithagent/agents/<name>/` with `state/`, `logs/`, `.env` and the work directory with the template. No `.mcp.json`. Name rule as the hub's.
- `up` starts a plain `claude` session when the agent has no library connection, and the current channel session when it has. Tasks are typed in `smithagent attach <agent>`.
- `joinlibrary` is the redeem half of today's `install`: it stores the library token, writes the channel settings and `.mcp.json`. The agent keeps the identity the link gave it (`haojian-agent7`) in the library; the local name stays its handle. `status` shows both when they differ.
- `joinhub` runs `query-hub join <hub-url> --name <agent>` with the agent's token file, adds `QUERY_HUB_CONFIG` to `.env`, adds `Bash(query-hub *)` to the work directory's allowlist, and appends a marked "PersonalDataHub" section to its `CLAUDE.md` if the marker is absent.
- Both joins tell the user to restart a running agent (`down`, `up`).
- `status` lists each agent's connections. `remove --revoke` also runs `query-hub leave`.
- Existing agents are untouched: they are agents with a library connection.
- **One name everywhere** (Haojian, 2026-11-25: "remove the naming feature in library. when the local agent join the library, it will send the name to the library. agent name is a required property when creating smithagents."). The name given to `smithagent create` is sent at both joins. The library's `POST /v1/agents/join` now takes `{code, name}` like the hub's `POST /agent/join`; a library link carries only the channel and scopes; the `<login>-agent<n>` default, the per-member counter and the Name field are gone (library migration 014). `create` enforces the library's rule (3-40 characters, lowercase letters, digits and hyphens, starting with a letter, not ending with a hyphen), which is stricter than the hub's, so one name is valid in both. This replaces the two bullets above that describe a separate library identity.
- `install`, `add` and `channels` are removed. Haojian: "we are fast iterating the design. better have a clean design." An agent is always created first, and a library link is the only way into a channel. The gh-login mode (`install <channel> --agent <name>`) goes with them.

The template's `CLAUDE.md` becomes a generic base; the library instructions move into a marked section that `joinlibrary` appends, the same way `joinhub` appends its own. Existing work directories are not rewritten.

### query-hub

One dependency-free Node file. The hub owns its client, so the canonical copy is `bin/query-hub` in PersonalDataHub, exposed as a `query-hub` command by the package (`npm link` or `npx`), for people who use the hub without smithagent. smithagent carries a vendored copy at `smithagent/bin/query-hub`, and `joinhub` installs it into `~/.smithagent/bin/`, the directory `up` already puts on the agent's PATH. Both READMEs state that the hub's copy is the source and the other is copied from it. (My call. Fetching the client from the hub named in a join link was rejected: it would run code from whatever host a link points at.) It reads its token file from `QUERY_HUB_CONFIG`, else `~/.pdh/agent.json`. The file holds `{ hub, token, agent_name, agent_id }`, mode 0600.

```
query-hub join <hub-url> --name <name>     redeem a link, write the token file
query-hub me                               name and permissions
query-hub sources                          sources this agent may pull, and whether each is connected
query-hub pull <source> --purpose <text> [--query <q>] [--limit <n>]
query-hub propose <source> <action_type> --purpose <text> --data '<json>'
query-hub leave                            revoke this agent at the hub, delete the token file
```

Output is the hub's JSON on stdout. Errors go to stderr with a non-zero exit and a one-line cause: no token file ("run query-hub join"), 401 ("this agent was revoked at the hub"), 403 (the missing permission), connection refused ("the hub is not running at <url>"). The token is never printed.

## Left to the builder

- DynamoDB key layout for the two tables.
- Layout details of the Agents screen beyond the sketch; how often the open "Add agent" panel refreshes the list.
- Argument parsing in `query-hub` and the bash structure of the new smithagent commands.
- Wording of the two `CLAUDE.md` sections.
- How to test the bash CLI (the repository has only `channel/test/smoke.mjs`); at minimum a scripted run against a temporary `SMITHAGENT_HOME` and a hub started on a scratch database.

## Testing

Hub (vitest):

- Phone hub: with a device secret configured, both join routes give 404.
- Join: a code works once; an expired, used or unknown code gives 410; a bad or taken name gives 400 or 409 and leaves the code usable; the token is returned only by the join call and only its hash is stored.
- Permissions: pull or propose for an unticked source gives 403; `sources` is filtered; changing permissions takes effect on the next call; the owner passes.
- Revoke and leave: the token gets 401 on the next call; the name can be reused.
- The route walk in `access.test.ts` still passes with the two join routes added to its open list, and an agent token cannot call any `/web/agents` route.
- No reference to MCP remains in `src/`, `package.json`, or the pages.

smithagent: scripted end-to-end against a scratch hub: `create`, `joinhub`, `query-hub me`, `pull`, `propose`, revoke at the hub then `me` reports it, `leave`. `joinlibrary` on a created agent is checked against the library's dev server (`TestServeForBrowser`).

Manual: in the browser, add an agent, run `smithagent joinhub`, watch it appear, untick a source, see the pull refused.
