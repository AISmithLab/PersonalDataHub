# Setup

How to install and run PersonalDataHub.

## Option A: Install via ClawHub (Recommended for OpenClaw users)

Install PersonalDataHub as an [OpenClaw](https://theoperatorvault.io) skill through [ClawHub](https://theoperatorvault.io/clawhub-guide), the community marketplace for OpenClaw skills.

### Prerequisites

- **Node.js >= 22** — check with `node --version`
- **pnpm** — install with `npm install -g pnpm`
- **OpenClaw** installed and running
- **ClawHub CLI** — install with `npm i -g clawhub`

### Step 1: Install the Skill

```bash
clawhub install personaldatahub
```

This downloads the skill and runs the install hook, which:
1. Installs dependencies (`pnpm install`)
2. Builds the project (`pnpm build`)
3. Runs `npx pdh init "OpenClaw Agent"` — generates a master secret, config, database, and owner password
4. Saves hub config to `~/.pdh/config.json` (auto-read by agents)
5. Starts the server in the background (`npx pdh start`)

No manual configuration needed — agents read config automatically.

### Step 2: Connect Data Sources

Open `http://localhost:3000` in your browser and log in with the owner password printed during init:

1. **Gmail** — Click "Connect Gmail" to start OAuth. Configure quick filters (date range, senders, subjects, hidden fields).
2. **GitHub** — Click "Connect GitHub" to start OAuth. Select which repos the agent can access and at what permission level.

### Step 3: Verify

Ask your AI agent:

> "Check my recent emails"

Verify in the GUI:
- **Gmail tab** → Recent Activity shows the pull request
- **Settings tab** → Audit Log shows every data access with timestamps and purpose strings

### Updating

```bash
clawhub update personaldatahub
```

---

## Option B: Install from Source

Install directly from the repository. Works with any MCP-compatible agent (Claude Code, Cursor, Windsurf) or without any agent framework.

### Prerequisites

- **Node.js >= 22** — check with `node --version`
- **pnpm** — install with `npm install -g pnpm`

### Step 1: Clone and Bootstrap

```bash
git clone https://github.com/AISmithLab/PersonalDataHub.git
cd PersonalDataHub
pnpm install && pnpm build
npx pdh init
```

This generates:
- A master secret (`.env`)
- Server config (`hub-config.yaml`)
- SQLite database (`pdh.db`)
- Owner password (printed to console — save it)
- Global config at `~/.pdh/config.json` (auto-read by agents and the MCP server)

### Step 2: Start the Server

```bash
npx pdh start
```

This starts the server in the background. The server does **not** auto-start on reboot — run `npx pdh start` again after restarting your machine.

Verify it's running:

```bash
npx pdh status
# or: curl http://localhost:3000/health
```

Other server commands:

```bash
npx pdh stop     # Stop the background server
npx pdh status   # Check if the server is running
npx pdh reset    # Remove all generated files and start fresh
```

### Step 3: Connect Your Agent

#### MCP Agent (Claude Code, Cursor, Windsurf)

Add PersonalDataHub as an MCP server in your agent's config. For Claude Code, add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "personaldatahub": {
      "command": "npx",
      "args": ["pdh", "mcp"]
    }
  }
}
```

The MCP server (`npx pdh mcp`) reads `~/.pdh/config.json` for the hub URL, verifies the server is running, discovers which sources are connected, and registers source-specific tools. Only connected sources get tools — disconnect Gmail and the `read_emails` tool disappears.

You can also test the MCP server standalone:

```bash
npx pdh mcp
# Prints registered tools to stderr, then listens on stdio
```

#### OpenClaw

The skill is in `packages/personaldatahub/`. OpenClaw discovers skills from directories containing a `SKILL.md` with YAML frontmatter. To register it, pick one option:

**Option 1: Symlink into the global skills directory (Recommended)**

```bash
mkdir -p ~/.openclaw/skills
ln -s /absolute/path/to/PersonalDataHub/packages/personaldatahub ~/.openclaw/skills/personaldatahub
```

Replace `/absolute/path/to/PersonalDataHub` with the actual path to your cloned repo. This makes the skill available in all OpenClaw sessions.

**Option 2: Add as an extra skills directory**

Add the parent directory (the one that *contains* the skill folder) to `skills.load.extraDirs` in `~/.openclaw/openclaw.json`:

```json
{
  "skills": {
    "load": {
      "extraDirs": ["/absolute/path/to/PersonalDataHub/packages"]
    }
  }
}
```

`extraDirs` entries are scanned for subdirectories with a `SKILL.md` — point to `packages/`, not `packages/personaldatahub/`.

Start a new OpenClaw session for it to discover the skill.

The skill reads config automatically from `~/.pdh/config.json` — no manual configuration needed.

**Not using any agent framework?** Skip this step — you can use the API directly. See [Direct API Usage](#direct-api-usage) below.

### Step 4: Connect Data Sources

Open `http://localhost:3000` in your browser. Log in with the owner password printed during `npx pdh init`. Default OAuth credentials were configured during init — just click Connect.

#### Connecting Gmail

1. Click the **Gmail** tab, then **Connect Gmail**
2. Sign in with your Google account and grant PersonalDataHub access
3. Configure quick filters to control what agents can see:
   - **Only emails after** — restrict to recent emails
   - **Only from sender** / **Exclude sender** — filter by sender
   - **Subject contains** / **Exclude subject containing** — filter by subject
   - **Only with attachments** — keep only emails with attachments
   - **Hide field from agents** — remove specific fields (e.g., body, sender info)

#### Connecting GitHub

1. Click the **GitHub** tab, then **Connect GitHub**
2. Authorize PersonalDataHub to access your GitHub account
3. Select which repos the agent can access and set permission levels per repo

To set up the agent's GitHub account:
1. Create a separate GitHub account for your AI agent (e.g., `@alice-ai-agent`)
2. In the PersonalDataHub GUI, enter the agent's GitHub username
3. PersonalDataHub uses your (the owner's) OAuth token to add the agent as a collaborator on the repos you select
4. The agent uses its own credentials (fine-grained PAT) to interact with GitHub directly

**Advanced:** To use your own OAuth app instead of the defaults, see [OAUTH-SETUP.md](./OAUTH-SETUP.md).

### Step 5: Verify

Same as Option A Step 3 — ask your agent to check recent emails and verify activity in the GUI.

---

## Direct API Usage

Any HTTP client can use PersonalDataHub's endpoints. No auth is required — the server binds to `127.0.0.1` (localhost only). The GUI is password-protected separately.

### Pull Data

```bash
curl -X POST http://localhost:3000/app/v1/pull \
  -H "Content-Type: application/json" \
  -d '{"source": "gmail", "purpose": "Find recent emails"}'
```

### Propose an Action

```bash
curl -X POST http://localhost:3000/app/v1/propose \
  -H "Content-Type: application/json" \
  -d '{
    "source": "gmail",
    "action_type": "draft_email",
    "action_data": {"to": "alice@co.com", "subject": "Hi", "body": "Hello"},
    "purpose": "Draft greeting"
  }'
```

Actions are staged for owner review — not executed until approved via the GUI.

### Discover Connected Sources

```bash
curl http://localhost:3000/app/v1/sources
```

Returns which sources are configured and which have active OAuth tokens.

---

## Quick Filters

The GUI provides toggle-based quick filters for Gmail. Each filter can be enabled/disabled independently:

| Filter | What it does |
|---|---|
| Only emails after | Drop emails before a given date |
| Only from sender | Keep emails where sender contains a value |
| Subject contains | Keep emails where subject contains a value |
| Exclude sender | Drop emails where sender matches |
| Exclude subject containing | Drop emails where subject matches |
| Only with attachments | Keep only emails that have attachments |
| Hide field from agents | Remove a field (e.g., body) before delivery |

Filters are applied at read time on every request.

---

## How Auto-Setup Works

When an agent connects (via MCP or the OpenClaw skill), it resolves config in this order:

1. **MCP server** — `npx pdh mcp` reads `~/.pdh/config.json` directly
2. **Plugin config** — `hubUrl` passed directly (OpenClaw skill)
3. **Environment variables** — `PDH_HUB_URL`
4. **Config file** — reads `~/.pdh/config.json` (written by `npx pdh init`)
5. **Auto-discovery** — probes `localhost:3000`, `localhost:7007`, `127.0.0.1:3000`, `127.0.0.1:7007` for a running hub

If no config is found at any step, the agent logs setup instructions and gracefully degrades (no tools registered).

## What `npx pdh init` Does

The init command creates:

| File | Purpose |
|------|---------|
| `.env` | Contains `PDH_SECRET=<random 32-byte base64>` — the master encryption key for OAuth tokens |
| `hub-config.yaml` | Config with source OAuth credentials and `port: 3000` — sources are connected via the GUI |
| `pdh.db` | SQLite database with all tables initialized (oauth_tokens, filters, staging, audit_log, owner_auth) |
| `~/.pdh/config.json` | Hub config (`hubUrl`, `hubDir`) — auto-read by the MCP server and agents at startup |

It also generates an owner password for the GUI and prints it to the console.

## Publishing to ClawHub

To publish or update the skill on ClawHub:

```bash
clawhub publish packages/personaldatahub \
  --slug personaldatahub \
  --name "PersonalDataHub" \
  --version 0.1.0 \
  --tags latest
```

## Contributing

Want to contribute to PersonalDataHub? See [DEVELOPMENT.md](./DEVELOPMENT.md) for the project structure, tech stack, how to add connectors, and how to run the test suite.

## Troubleshooting

**MCP server says "No PersonalDataHub config found"**
- Run `npx pdh init` first, then `npx pdh start`

**MCP server says "not reachable"**
- Make sure PersonalDataHub is running: `npx pdh status`
- If not running, start it: `npx pdh start`

**No tools appear in MCP**
- Connect at least one source via OAuth in the GUI at `http://localhost:3000`
- Only sources with active OAuth tokens get tools registered

**`npx pdh init` fails with ".env already exists"**
- You've already initialized. Just start the server: `npx pdh start`
- To re-initialize: `npx pdh reset` then `npx pdh init`

**Server won't start**
- Check if already running: `npx pdh status`
- Stop it first: `npx pdh stop`, then start again

**Port already in use**
- Edit `hub-config.yaml` and change `port: 3000` to a different port
- Re-run `npx pdh init` or update `~/.pdh/config.json` to match the new URL

**OAuth redirect fails**
- Make sure the redirect URI in your Google Cloud / GitHub OAuth app settings matches `http://localhost:3000/oauth/<source>/callback` (e.g., `http://localhost:3000/oauth/gmail/callback`)
