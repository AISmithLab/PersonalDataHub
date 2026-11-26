# Setup

How to install and run PersonalDataHub.

PersonalDataHub uses **two OS users** for security isolation:

- **`personaldatahub` user** — runs the server, owns the database and OAuth tokens. You switch to this user to manage sources and approve actions via the GUI.
- **Your main user** — runs AI agents (Claude Code, Cursor, etc.). Agents talk to the server over localhost HTTP. They cannot read the database or OAuth tokens directly.

This separation means a compromised agent cannot extract your Gmail/GitHub OAuth tokens from disk — the files are owned by a different OS user with `0600` permissions.

## Prerequisites

- **Node.js >= 22** — check with `node --version`
- **pnpm** — install with `npm install -g pnpm`
- **sudo access** — needed to create the `personaldatahub` OS user

## Step 1: Create the `personaldatahub` OS User

### macOS

```bash
# Create a hidden system user (no home directory login shell)
sudo sysadminctl -addUser personaldatahub -shell /bin/zsh -password -
# Create its home directory
sudo mkdir -p /Users/personaldatahub
sudo chown personaldatahub:staff /Users/personaldatahub
```

### Linux

```bash
sudo useradd -r -m -s /bin/bash personaldatahub
```

## Step 2: Clone and Bootstrap as `personaldatahub`

Switch to the `personaldatahub` user and install:

```bash
sudo -u personaldatahub -i
cd ~
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
| `pdh.db` | SQLite database (owned by `personaldatahub`, mode `0600`) |
| `~personaldatahub/.pdh/config.json` | Hub URL and directory, used by the `pdh` command itself |

`npx pdh init` does not create any agent credential. Agents register later with a join link (Step 5).

## Step 3: Start the Server

Still as the `personaldatahub` user:

```bash
npx pdh start
```

Verify it's running:

```bash
npx pdh status
# or: curl http://localhost:3000/health
```

The server does **not** auto-start on reboot by default. You can either run `npx pdh start` after each restart, or install a system service (see below).

You can now exit the `personaldatahub` shell:

```bash
exit
```

### Optional: Auto-start on reboot

To have PersonalDataHub start automatically on boot, install a system service. Run this as your **main user** (not `personaldatahub`), since it requires sudo:

```bash
sudo npx pdh install-service
```

This creates a systemd service (Linux) or launchd daemon (macOS) that runs the server as the `personaldatahub` user.

**Manage the service:**

```bash
# Linux
sudo systemctl status personaldatahub    # check status
sudo systemctl restart personaldatahub   # restart
journalctl -u personaldatahub -f         # view logs

# macOS
sudo launchctl list | grep personaldatahub   # check status
```

**Remove the service:**

```bash
sudo npx pdh uninstall-service
```

## Step 4: Connect Data Sources

To connect Gmail, GitHub, and other sources, you need to open the PersonalDataHub GUI at `http://localhost:3000` and sign in. The first visit asks you to create the owner account.

Open the GUI in a browser session that the agent cannot access. This prevents the agent from reading the session cookie and calling admin endpoints. See the [Browser Session Security](./architecture-design/design-v2.md#browser-session-security) section in the design doc for a detailed explanation.

### Approach 1: SSH tunnel from a different machine (recommended for servers)

If PersonalDataHub runs on a remote or headless server, SSH tunnel from your local machine:

```bash
ssh -L 3000:localhost:3000 youruser@your-server
```

Then open `http://localhost:3000` in your **local** browser. The session cookie lives in your local browser — the agent on the server has no way to access it. This is the most secure approach.

### Approach 2: Separate desktop session (macOS)

On macOS, open the GUI in a browser running as the `personaldatahub` user. The browser cookie file will be owned by `personaldatahub` with `0600` permissions, so the agent running as your main user cannot read it.

```bash
# Option A: Open Safari as the personaldatahub user
sudo -u personaldatahub open -a Safari http://localhost:3000

# Option B: Use Fast User Switching (System Settings > Login Window)
# Log in as personaldatahub and open a browser there
```

### Approach 3: Separate desktop session (Linux desktop)

On Linux with a desktop environment, switch to the `personaldatahub` user's session:

```bash
# Switch to a new TTY (Ctrl+Alt+F2), log in as personaldatahub, and open a browser
sudo -u personaldatahub -i
firefox http://localhost:3000 &
```

Or use your display manager's user switching feature to log into a `personaldatahub` desktop session.

### In the GUI

On the first visit the GUI asks you to create the owner account (email and password). Only this account can change settings and approve actions. Then:

**Gmail:**
1. Click the **Gmail** tab, then **Connect Gmail**
2. Sign in with your Google account and grant PersonalDataHub access
3. Configure quick filters to control what agents can see

**GitHub:**
1. Click the **GitHub** tab, then **Connect GitHub**
2. Authorize PersonalDataHub to access your GitHub account
3. Select which repos the agent can access

To use your own OAuth credentials instead of the defaults, see [OAUTH-SETUP.md](./OAUTH-SETUP.md).

## Step 5: Connect Your Agent (Main User)

Each agent registers with the hub once, using a join link. No key is copied by hand. You can register several agents; each gets its own name, permissions, and token.

### Create a join link (in the GUI, as the owner)

1. Open **Settings → Agents** and click **Add agent**.
2. Tick what the agent may do for each source: read (`pull:<source>`) and propose (`propose:<source>`). Sources are `gmail`, `google_calendar`, `github`, and `photo`.
3. Copy the join link. It looks like `http://127.0.0.1:3000/agent/join/<code>`. It works once and expires after 15 minutes.

### Join (as your main user)

The agent's client is `query-hub`, a single Node file with no dependencies at `bin/query-hub.mjs` in the repository. Your main user needs its own copy of that file (for example from a clone of the repository). Run `npm link` in the clone to get a `query-hub` command, or run `node bin/query-hub.mjs` in its place.

```bash
query-hub join http://127.0.0.1:3000/agent/join/<code> --name my-agent
```

With smithagent: `smithagent joinhub <agent> <link>`.

The name is 1-63 characters of `a-z`, `0-9`, and `-`. The hub returns the agent's token (`pdh_...`) once. `query-hub` stores it in `~/.pdh/agent.json` with mode `0600` and never prints it. To keep the file elsewhere, or to register a second agent under the same OS user, set `QUERY_HUB_CONFIG` to another path before joining.

Check the registration:

```bash
query-hub me        # the agent's name and permissions
query-hub sources   # the sources it may read, and whether each is connected
```

From then on the agent reads data with `query-hub pull` and proposes actions with `query-hub propose`. See [Agent commands](../README.md#agent-commands).

### Change or revoke an agent

In **Settings → Agents** you can edit an agent's permissions or revoke it. A revoked agent gets 401 on its next call. An agent can also remove itself with `query-hub leave`.

### OpenClaw (via ClawHub)

Install the PersonalDataHub skill from ClawHub:

```bash
clawhub install personaldatahub
```

The plugin reads the hub address and token from the file `query-hub join` writes, so join first. You can instead set `hubUrl` and `apiKey` (the agent's token) in the plugin's settings. It registers `personal_data_pull` and `personal_data_propose` tools. See [`packages/personaldatahub/SKILL.md`](../packages/personaldatahub/SKILL.md).

## Step 6: Verify

Ask your agent:

> "Check my recent emails"

Verify in the GUI (as the `personaldatahub` user):
- **Gmail tab** → Recent Activity shows the pull request
- **Settings tab** → Audit Log shows every data access with timestamps and purpose strings

---

## Managing the Server

All server management commands must be run as the `personaldatahub` user:

```bash
sudo -u personaldatahub -i
cd ~/PersonalDataHub

npx pdh status   # Check if the server is running
npx pdh stop     # Stop the background server
npx pdh start    # Start the server
npx pdh reset    # Remove all generated files and start fresh
```

To approve staged actions or change filters, switch to the `personaldatahub` user's browser session and open `http://localhost:3000`.

---

## Direct API Usage

`query-hub` is the normal way for an agent to reach the hub. It calls the routes below and keeps the token out of the agent's conversation. Call the API directly only if you are writing your own client.

| Prefix | For | Credential |
|---|---|---|
| `/agent/*` | Agents: pull data, propose actions | A registered agent's token: `Authorization: Bearer pdh_...` |
| `/web/*` | The GUI: settings, approvals, audit log, agents | The owner's session cookie, set by signing in |

`GET /health` needs no credential and returns no data. The two join routes (`GET /agent/join/:code`, `POST /agent/join`) also take no credential. They are protected by the one-time code in the link.

In the examples, `$TOKEN` is an agent token: the `token` value in the file `query-hub join` wrote.

**Pull data:**

```bash
curl -X POST http://localhost:3000/agent/pull \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source": "gmail", "purpose": "Find recent emails"}'
```

**Propose an action:**

```bash
curl -X POST http://localhost:3000/agent/propose \
  -H "Authorization: Bearer $TOKEN" \
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
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/agent/sources
```

---

## Troubleshooting

**`query-hub` says "Not registered with a hub"**
- The agent has not joined. Create a join link in **Settings → Agents** and run `query-hub join <link> --name <name>` (see Step 5)

**`query-hub join` says the link "was already used or has expired"**
- A join link works once and lasts 15 minutes. Create a new one in **Settings → Agents**

**`query-hub` says "The hub is not running"**
- The server runs as the `personaldatahub` user: `sudo -u personaldatahub -i`, then `cd ~/PersonalDataHub && npx pdh status`
- If not running: `npx pdh start` in the same shell

**`query-hub` says the agent "was revoked"**
- The owner revoked it, or it was never registered with this hub. Run `query-hub leave` to clear the old token, then join again with a new link

**`query-hub` says "Not allowed: this agent lacks the ... permission"**
- Grant the named permission to the agent in **Settings → Agents**

**`query-hub pull` says the source "is not connected"**
- Connect the source via OAuth in the GUI (as the `personaldatahub` user)

**`npx pdh init` fails with ".env already exists"**
- Already initialized. Start the server: `npx pdh start`
- To re-initialize: `npx pdh reset` then `npx pdh init`

**Permission denied accessing pdh.db**
- The database is owned by the `personaldatahub` user. Run server commands as that user.
- Agents should never access the DB directly — they use the HTTP API.

**OAuth redirect fails**
- Make sure the redirect URI in your OAuth app settings matches `http://localhost:3000/oauth/<source>/callback`
