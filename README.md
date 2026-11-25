# PersonalDataHub

**An open-source, self-hosted data hub between your personal services (Gmail, GitHub, etc.) and your AI agents.**

PersonalDataHub connects to your accounts via OAuth2 and lets AI agents query them through the `query-hub` command or the REST API — all running locally on your machine, with no data sent to third parties. You configure quick filters to control what agents can see, and review every action they propose before it's executed.

![](architecture.png)

---

## Features

- **Zero access by default** — agents see nothing until you explicitly whitelist access
- **OAuth2 integration** — connect Gmail, GitHub, and more with secure PKCE OAuth flows
- **Quick filters** — control what agents can see: date ranges, senders, subjects, hidden fields
- **Action staging** — every outbound action (drafts, replies, sends) is queued for your review and approval before execution
- **Agent registration**: you create a one-time join link in Settings → Agents and choose what the agent may read and propose, per source. You can change its permissions or revoke it at any time. No key is copied by hand.
- **`query-hub` command**: a registered agent reads data and proposes actions with `query-hub pull` and `query-hub propose`. Its token stays in a file only the command reads.
- **Skills**: high-level workflows (e.g., email-assistant) that orchestrate multi-step tasks on top of `query-hub`
- **REST API** — pull data and propose actions via simple HTTP endpoints under `/agent/*`
- **Web GUI** — built-in admin dashboard for managing sources, filters, staging, and audit logs
- **Audit log** — every data access and action is logged with purpose, timestamp, source, and the name of the agent that made the call
- **AES-256-GCM encryption** — OAuth tokens are encrypted at rest
- **Multiple agents**: register any number of agents, each with its own name, permissions, and token. Any agent that can run a shell command can use `query-hub`.
- **Extensible** — add new data sources by implementing the `SourceConnector` interface

### Data Sources

| Source | Read | Write |
|--------|------|-------|
| **Gmail** | Emails (filtered by date, labels) | Draft / reply / send (staged for approval) |
| **GitHub** | Issues and PRs from selected repos | Via agent's own scoped credentials |

---

## Installation & Authentication

### Prerequisites

- **Node.js** 22+
- **pnpm** (package manager)
- A **Gmail** and/or **GitHub** account to connect

### 1. Install and Start the Server

```bash
git clone https://github.com/AISmithLab/PersonalDataHub.git
cd PersonalDataHub && pnpm install && pnpm build

# Initialize
npx pdh init

# Start the server
npx pdh start
```

### 2. Connect Your Sources via OAuth

Open `http://localhost:3000` in your browser.

1. Click **Connect Gmail** — authenticate via Google's OAuth2 consent screen
2. Click **Connect GitHub** — authenticate via GitHub's OAuth2 flow
3. Configure **quick filters** to control what agents can see

> To use your own OAuth credentials instead of the defaults, see [OAuth Setup](systemdesigns/OAUTH-SETUP.md).

### 3. Connect an agent

An agent registers with the hub once, using a join link you create.

1. In the GUI, open **Settings → Agents** and click **Add agent**.
2. Tick what the agent may do for each source (read, propose). Sources are `gmail`, `google_calendar`, `github`, and `photo`.
3. Copy the join link. It looks like `http://127.0.0.1:3000/agent/join/<code>`, works once, and expires after 15 minutes.

On the machine where the agent runs, make the `query-hub` command available and join:

```bash
# In the PersonalDataHub repo. Or skip this and run `node bin/query-hub.mjs` in place of `query-hub`.
npm link

query-hub join http://127.0.0.1:3000/agent/join/<code> --name my-agent
```

With smithagent: `smithagent joinhub <agent> <link>`.

The name is 1-63 characters of `a-z`, `0-9`, and `-`. The hub returns the agent's token once. `query-hub` stores it in `~/.pdh/agent.json` (or the file named by `$QUERY_HUB_CONFIG`) with mode `0600` and never prints it.

You can edit an agent's permissions or revoke it in **Settings → Agents**. A revoked agent gets 401 on its next call.

> For **OpenClaw** setup (with OS-level user separation for stronger isolation), see the [OpenClaw Setup Guide](systemdesigns/OPENCLAW-SETUP.md).

---

## Agent commands

A registered agent uses `query-hub`. Output is JSON on stdout.

```
query-hub me          This agent's name and what it may do
query-hub sources     The sources it may read, and whether each is connected
query-hub pull <source> --purpose <why> [--query <search>] [--limit <n>]
query-hub propose <source> <action-type> --purpose <why> --data '<json>'
query-hub leave       Remove this agent from the hub and delete its token
```

Every pull and propose needs `--purpose`. The hub records it in the audit log.

**Pull** returns data filtered by the owner's quick filters:

```bash
query-hub pull gmail --purpose "Find emails about Q4 report to summarize for user" --query "subject:Q4 newer_than:30d" --limit 20
```

**Propose** stages an action. Nothing is carried out until the owner approves it in the GUI:

```bash
query-hub propose gmail draft_email --purpose "Draft reply about Q4 report" \
  --data '{"to":"bob@company.com","subject":"Re: Q4 Report","body":"Thanks Bob, the numbers look good."}'
```

Gmail action types are `draft_email`, `send_email`, and `reply_email`. If the agent lacks a permission, the command names the missing one (for example `pull:gmail`).

---

## Quick Filters

Control what data agents can see using simple toggle-based filters in the GUI:

| Filter | What it does |
|--------|-------------|
| **Only emails after** | Drop rows before a given date |
| **Only from sender** | Keep rows where sender contains a value |
| **Subject contains** | Keep rows where subject contains a value |
| **Exclude sender** | Drop rows where sender matches |
| **Exclude subject containing** | Drop rows where subject matches |
| **Only with attachments** | Keep only rows that have attachments |
| **Hide field from agents** | Remove a field (e.g., body) before delivery |

---

## Skills

Skills are high-level workflows that use `query-hub` to handle multi-step tasks.

| Skill | Description |
|-------|-------------|
| [`email-assistant`](skills/email-assistant/SKILL.md) | Parse a natural language email request, search for relevant emails, analyze context, and draft a response |

**Installation (Claude Code):** Copy the skill folder to `~/.claude/skills/`, then invoke with `/email-assistant`.

---

## CLI Commands

```
npx pdh init [app-name]     Bootstrap a new installation
npx pdh start               Start the server in the background
npx pdh stop                Stop the background server
npx pdh status              Check if the server is running
npx pdh install-service     Install a systemd/launchd service for auto-start on reboot
npx pdh uninstall-service   Remove the auto-start service
npx pdh reset               Remove all generated files and start fresh
```

---

## Security Model

PersonalDataHub runs on **your local machine**. OAuth tokens are encrypted at rest with AES-256-GCM and the server binds to `127.0.0.1` (localhost only).

**Three layers of access control:**

1. **Credential scope** — the agent holds a scoped identity that can't access resources outside the boundary
2. **Query boundary** — the connector refuses to fetch data outside configured limits (date range, repo list, label filters)
3. **Quick filters** — further restrict which rows are visible and which fields are delivered to the agent

**What the agent cannot do:**

- Access any data outside the configured boundary
- See fields hidden by quick filters
- Send emails or execute actions without owner approval
- Delete anything — no destructive endpoints exist

For the full threat model, see [SECURITY.md](systemdesigns/SECURITY.md).

---

## Demo

https://github.com/user-attachments/assets/62e7a26a-44a6-4a78-8b99-59e66b1e8464

---

## Mobile App (Android / iOS)

PersonalDataHub runs as a self-contained Android or iOS app using React Native. The existing Hono backend runs in a native Node.js Mobile background thread; the UI is a WebView loading `127.0.0.1:3000`.

```bash
cd mobile && npm install && npm run build:android
```

See the [Android Build Guide](systemdesigns/ANDROID-BUILD-GUIDE.md) for full setup, prerequisites, and troubleshooting.

---

## Documentation

- [Setup Guide](systemdesigns/SETUP.md) — install, connect sources, and connect your agent
- [Android Build Guide](systemdesigns/ANDROID-BUILD-GUIDE.md) — build and run the Android/iOS app
- [OpenClaw Setup](systemdesigns/OPENCLAW-SETUP.md) — install with OS-level user separation for OpenClaw
- [OAuth Setup](systemdesigns/OAUTH-SETUP.md) — using your own OAuth credentials
- [Development Guide](systemdesigns/DEVELOPMENT.md) — codebase structure, adding connectors, testing
- [Security & Threat Model](systemdesigns/SECURITY.md) — detailed attack surface analysis
- [Design Doc v2](systemdesigns/architecture-design/design-v2.md) — full architecture and design rationale
- [Skills vs MCP](systemdesigns/architecture-design/skills-vs-mcp.md): historical note. The MCP server it discusses has been removed.

## License

Apache 2.0
