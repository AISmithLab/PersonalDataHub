# Auto Setup (OpenClaw)

How to set up Peekaboo automatically through ClawHub or the OpenClaw extension.

## Overview

Peekaboo can be installed as an OpenClaw skill through [ClawHub](https://theoperatorvault.io/clawhub-guide), the community marketplace for OpenClaw skills. The install hook bootstraps the Peekaboo hub, and the extension auto-discovers it at runtime.

## Option A: Install via ClawHub (Recommended)

### Prerequisites

- **Node.js >= 22** — check with `node --version`
- **pnpm** — install with `npm install -g pnpm`
- **OpenClaw** installed and running
- **ClawHub CLI** — install with `npm i -g clawhub`

### Step 1: Install the Skill

```bash
clawhub install peekaboo-personal-data-hub
```

This downloads the skill and runs the install hook, which:
1. Installs dependencies (`pnpm install`)
2. Builds the project (`pnpm build`)
3. Runs `npx peekaboo init "OpenClaw Agent"` — generates a master secret, config, database, and API key

Save the API key printed to the console.

### Step 2: Configure Environment

Add your Peekaboo credentials to your OpenClaw config:

```json
{
  "skills": {
    "entries": {
      "peekaboo": {
        "env": {
          "PEEKABOO_HUB_URL": "http://localhost:3000",
          "PEEKABOO_API_KEY": "pk_your_key_from_step_1"
        }
      }
    }
  }
}
```

### Step 3: Start the Server

```bash
cd peekaboo
node dist/index.js
```

The server starts at `http://localhost:3000`.

### Step 4: Connect Data Sources

Open `http://localhost:3000` in your browser:

1. **Gmail** — Click "Connect Gmail" to start OAuth. Configure access boundaries (date range, labels, field access, redaction rules).
2. **GitHub** — Click "Connect GitHub" to start OAuth. Select which repos the agent can access and at what permission level.

### Step 5: Verify

Ask your AI agent:

> "Check my recent emails"

The agent uses `personal_data_pull` through Peekaboo. Verify in the GUI:
- **Gmail tab** → Recent Activity shows the pull request
- **Settings tab** → Audit Log shows every data access with timestamps and purpose strings

### Updating

```bash
clawhub update peekaboo-personal-data-hub
```

---

## Option B: Install from Source

If you prefer to install directly from the repository instead of ClawHub.

### Step 1: Clone and Bootstrap

```bash
git clone https://github.com/AISmithLab/Peekaboo.git
cd peekaboo
pnpm install && pnpm build
npx peekaboo init
```

Output:

```
  Peekaboo initialized successfully!

  .env created            /path/to/peekaboo/.env
  hub-config.yaml created  /path/to/peekaboo/hub-config.yaml
  Database created         /path/to/peekaboo/peekaboo.db

  API Key (save this — shown only once):
    pk_abc123def456...
```

You can pass a custom app name:

```bash
npx peekaboo init "My AI Agent"
```

### Step 2: Start the Server

```bash
node dist/index.js
```

Verify it's running:

```bash
curl http://localhost:3000/health
# {"ok":true,"version":"0.1.0"}
```

### Step 3: Install the Extension in OpenClaw

The extension is in `packages/personal-data-hub/`.

**Auto-discovery**: If the Peekaboo hub is running on `localhost:3000` or `localhost:7007`, the extension auto-discovers it and creates an API key. No configuration needed.

```
PersonalDataHub: Discovered hub at http://localhost:3000
PersonalDataHub: Auto-created API key. Save this for your config: pk_...
PersonalDataHub: Registering tools (hub: http://localhost:3000)
```

**Manual configuration**: If the hub is on a non-default port, configure the extension:

```json
{
  "hubUrl": "http://localhost:3000",
  "apiKey": "pk_your_key_from_step_1"
}
```

### Step 4: Connect Data Sources

Open `http://localhost:3000` in your browser. Connect Gmail and GitHub via OAuth. See the [Manual Setup Guide](SETUP-MANUAL.md) for detailed source configuration.

---

## How Auto-Setup Works

When the extension starts without a complete config (`hubUrl` + `apiKey`):

1. **Discovery** — probes `localhost:3000`, `localhost:7007`, `127.0.0.1:3000`, `127.0.0.1:7007` for a running hub by calling `GET /health`
2. **API key creation** — if a hub is found, calls `POST /api/keys` to create an API key for "OpenClaw Agent"
3. **Registration** — uses the discovered URL and created key to register the `personal_data_pull` and `personal_data_propose` tools

If no hub is found, the extension logs setup instructions and gracefully degrades (no tools registered).

## What `npx peekaboo init` Does

The init command creates three files:

| File | Purpose |
|------|---------|
| `.env` | Contains `PEEKABOO_SECRET=<random 32-byte base64>` — the master encryption key for cached data |
| `hub-config.yaml` | Minimal config with `sources: {}` and `port: 3000` — sources are configured via the GUI |
| `peekaboo.db` | SQLite database with all tables initialized (api_keys, manifests, cached_data, staging, audit_log) |

It also creates one API key and prints it to the console.

## Publishing to ClawHub

To publish or update the skill on ClawHub:

```bash
clawhub publish packages/personal-data-hub \
  --slug peekaboo-personal-data-hub \
  --name "Peekaboo Personal Data Hub" \
  --version 0.1.0 \
  --tags latest
```

## Troubleshooting

**Extension says "Missing hubUrl or apiKey. Auto-setup could not find a running hub."**
- Make sure Peekaboo is running: `curl http://localhost:3000/health`
- If not running, start it: `node dist/index.js`
- If running on a non-default port, configure manually with `PEEKABOO_HUB_URL`

**`npx peekaboo init` fails with ".env already exists"**
- You've already initialized. Just start the server: `node dist/index.js`
- To re-initialize, delete `.env`, `hub-config.yaml`, and `peekaboo.db` first

**Auto-setup creates a new API key each time the extension restarts**
- Set `PEEKABOO_API_KEY` in your OpenClaw config to use a fixed key
- Revoke unused keys in the GUI (Settings tab → API Keys → Revoke)

**Port already in use**
- Edit `hub-config.yaml` and change `port: 3000` to a different port
- Update `PEEKABOO_HUB_URL` in your OpenClaw config to match
