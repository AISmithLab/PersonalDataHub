# Setup Guide

How to install and run Peekaboo in a new environment.

## Prerequisites

- Node.js >= 22
- pnpm

## Installation

```bash
git clone <repo-url>
cd peekaboo

# Install dependencies
pnpm install

# Build
pnpm build

# Verify everything works
pnpm test
```

## Configuration

Copy the example config and edit it:

```bash
cp hub-config.example.yaml hub-config.yaml
```

### Server Settings

```yaml
server:
  port: 7007
  host: "127.0.0.1"       # Binds to localhost only

encryption:
  masterSecret: "${PEEKABOO_SECRET}"   # Used for encrypting cached data
```

### Gmail Source

```yaml
sources:
  gmail:
    enabled: true
    owner_auth:
      type: oauth2
      clientId: "${GMAIL_CLIENT_ID}"
      clientSecret: "${GMAIL_CLIENT_SECRET}"
    boundary:
      after: "2026-01-01"              # Only emails after this date
      # labels: ["inbox", "important"]
      # exclude_labels: ["spam", "trash"]
    # cache:
    #   enabled: true
    #   sync_interval: 30m
    #   ttl: 7d
```

To get Gmail OAuth credentials:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project and enable the Gmail API
3. Create OAuth 2.0 credentials (Desktop app type)
4. Set `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` environment variables

### GitHub Source

```yaml
sources:
  github:
    enabled: true
    owner_auth:
      type: personal_access_token
      token: "${GITHUB_PAT}"
    boundary:
      repos:
        - "myorg/frontend"
        - "myorg/api-server"
      types: ["issue", "pr", "commit"]
```

To get a GitHub PAT:
1. Go to GitHub Settings > Developer Settings > Personal Access Tokens > Fine-grained tokens
2. Create a token with access to the repos you want Peekaboo to manage
3. Set `GITHUB_PAT` environment variable

### Environment Variables

Config values using `${VAR_NAME}` syntax are resolved from environment variables. You can set them in your shell or use a `.env` file (not committed to git).

Required:
- `PEEKABOO_SECRET` — master encryption key for cached data

Per-source (depending on which sources you enable):
- `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` — Gmail OAuth credentials
- `GITHUB_PAT` — GitHub personal access token

## Running the Server

```bash
# Start the Hub
node dist/index.js

# Or with environment variables inline
PEEKABOO_SECRET=my-secret-key node dist/index.js
```

The server starts on `http://localhost:7007` (or whatever port you configured).

## Owner GUI

Open `http://localhost:7007/` in your browser to:

- Connect Gmail and GitHub via OAuth
- Configure access control policies per source (field selection, redaction, truncation)
- Choose from preset manifests or customize your own
- Review and approve/reject staged actions from AI agents
- Generate and manage API keys for agents
- View the audit log

### Preset Manifests

The GUI offers these presets for Gmail:

| Preset | What the agent sees |
|---|---|
| Read-only, recent emails | title, body, labels, timestamp — SSNs redacted |
| Metadata only | title, labels, timestamp — no body or sender info |
| Full access with redaction | All fields — sensitive patterns redacted, body truncated to 5000 chars |
| Email drafting | Can propose draft emails for owner review |

## API Keys

Generate API keys through the Owner GUI (Settings tab). Agents authenticate with:

```
Authorization: Bearer pk_xxx
```

## OpenClaw Extension

If you're using OpenClaw, the `packages/personal-data-hub/` extension connects your agent to Peekaboo. Configure it with your Hub URL and API key:

```json
{
  "hubUrl": "http://localhost:7007",
  "apiKey": "pk_your_key_here"
}
```

This registers two tools for the agent: `personal_data_pull` and `personal_data_propose`.
