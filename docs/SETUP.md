# Setup

How to install and run PersonalDataHub.

## Prerequisites

- **Node.js >= 22** — check with `node --version`
- **pnpm** — install with `npm install -g pnpm`

## Step 1: Clone and Bootstrap

```bash
git clone https://github.com/AISmithLab/PersonalDataHub.git
cd PersonalDataHub
pnpm install && pnpm build
npx pdh init
```

`npx pdh init` creates:

| File | Purpose |
|------|---------|
| `.env` | Master encryption key for OAuth tokens |
| `hub-config.yaml` | Server config with OAuth credentials and port |
| `pdh.db` | SQLite database |
| `~/.pdh/config.json` | Hub URL and directory — auto-read by the MCP server |

It also prints an **owner password** — save it. You need it to log into the GUI.

## Step 2: Start the Server

```bash
npx pdh start
```

Verify it's running:

```bash
npx pdh status
# or: curl http://localhost:3000/health
```

The server does **not** auto-start on reboot — run `npx pdh start` again after restarting your machine.

## Step 3: Connect Data Sources

Open `http://localhost:3000` in your browser and log in with the owner password.

Default OAuth credentials were configured during init — just click Connect.

### Gmail

1. Click the **Gmail** tab, then **Connect Gmail**
2. Sign in with your Google account and grant PersonalDataHub access
3. Configure quick filters to control what agents can see:
   - **Only emails after** — restrict to recent emails
   - **Only from sender** / **Exclude sender** — filter by sender
   - **Subject contains** / **Exclude subject containing** — filter by subject
   - **Only with attachments** — keep only emails with attachments
   - **Hide field from agents** — remove specific fields (e.g., body, sender info)

### GitHub

1. Click the **GitHub** tab, then **Connect GitHub**
2. Authorize PersonalDataHub to access your GitHub account
3. Select which repos the agent can access

To use your own OAuth credentials instead of the defaults, see [OAUTH-SETUP.md](./OAUTH-SETUP.md).

## Step 4: Connect Your Agent

Add PersonalDataHub as an MCP server in your agent's config.

**Claude Code** — add to `.claude/settings.json`:

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

**Cursor** — add to MCP settings in Cursor preferences with the same `command` and `args`.

**Windsurf** — add to MCP settings in Windsurf preferences with the same `command` and `args`.

The MCP server reads `~/.pdh/config.json`, verifies the server is running, and registers tools for connected sources only. Disconnect a source and its tools disappear.

You can test the MCP server standalone:

```bash
npx pdh mcp
# Prints registered tools to stderr, then listens on stdio
```

## Step 5: Verify

Ask your agent:

> "Check my recent emails"

Verify in the GUI:
- **Gmail tab** → Recent Activity shows the pull request
- **Settings tab** → Audit Log shows every data access with timestamps and purpose strings

---

## Direct API Usage

Any HTTP client can use PersonalDataHub's endpoints. No auth required — the server binds to `127.0.0.1` (localhost only).

**Pull data:**

```bash
curl -X POST http://localhost:3000/app/v1/pull \
  -H "Content-Type: application/json" \
  -d '{"source": "gmail", "purpose": "Find recent emails"}'
```

**Propose an action:**

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

**Discover connected sources:**

```bash
curl http://localhost:3000/app/v1/sources
```

---

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
- Update `~/.pdh/config.json` to match the new URL

**OAuth redirect fails**
- Make sure the redirect URI in your OAuth app settings matches `http://localhost:3000/oauth/<source>/callback`
