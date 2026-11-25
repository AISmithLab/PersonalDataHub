---
name: PersonalDataHub
description: Pull personal data (emails, issues) and propose outbound actions (drafts, replies) through the PersonalDataHub access control gateway. Data is filtered, redacted, and shaped by the owner's policy before reaching the agent.
version: 0.1.0
skillKey: personaldatahub
emoji: 🔐
homepage: https://github.com/AISmithLab/PersonalDataHub
os: darwin, linux, win32
install: cd ../../ && pnpm install && pnpm build && npx pdh init "OpenClaw Agent" && npx pdh start
metadata: {}
always: false
---

# PersonalDataHub

Access personal data from Gmail, GitHub, and other sources through the PersonalDataHub access control gateway. The data owner controls what the agent can see, which fields are visible, what gets redacted, and which actions are allowed.

## Setup

1. Run `query-hub me`. It prints this agent's name and permissions.
2. If it fails because the agent is not registered, ask the owner for a join link from **Settings → Agents** in the PersonalDataHub GUI, then run:

```bash
query-hub join <link> --name <name>
```

A join link works once and expires after 15 minutes. The token is stored in `~/.pdh/agent.json` (or `$QUERY_HUB_CONFIG`). Do not read or print that file.

The install hook builds and starts the hub. The owner then opens `http://localhost:3000` to connect Gmail/GitHub via OAuth and to create the join link.

## Commands

All output is JSON on stdout. Errors go to stderr with exit code 1.

### query-hub sources

List the sources this agent may read, and whether each is connected.

```bash
query-hub sources
```

### query-hub pull

Pull data from a source (`gmail`, `google_calendar`, `github`, `photo`). Data is filtered and redacted according to the owner's access control policy. Needs the `pull:<source>` permission.

**Options:**
- `--purpose` (required): why this data is needed (logged for audit)
- `--query` (optional): search query (for Gmail, e.g. `"is:unread from:alice newer_than:7d"`)
- `--limit` (optional): maximum number of results

```bash
query-hub pull gmail --purpose "Find unread emails about the Q4 report" --query "is:unread Q4 report" --limit 20
query-hub pull github --purpose "Find open issues about login" --query "login" --limit 10
```

### query-hub propose

Propose an outbound action. The action is staged for the data owner to review. It does NOT execute until approved. Needs the `propose:<source>` permission.

**Arguments and options:**
- `<source>` and `<action-type>` (required)
- `--purpose` (required): why this action is being proposed (logged for audit)
- `--data` (required for most actions): the action's fields as JSON

Gmail action types:
- `draft_email`: `to`, `subject`, `body`
- `send_email`: `to`, `subject`, `body`
- `reply_email`: `to`, `subject`, `body`, `in_reply_to` (thread ID of the email being replied to)

```bash
query-hub propose gmail draft_email --purpose "Draft reply about the Q4 report" \
  --data '{"to": "...", "subject": "...", "body": "..."}'
```

### query-hub leave

Remove this agent from the hub and delete its token.

## Troubleshooting

- **"Not registered with a hub"**: follow Setup above.
- **"it was revoked"**: the owner revoked this agent. Ask for a new join link, run `query-hub leave` to clear the old token, then join again.
- **"Not allowed: this agent lacks the ... permission"**: ask the owner to grant it in Settings → Agents.
- **"The hub is not running"**: ask the owner to start it with `npx pdh start`.
- **"Source ... is not connected"**: ask the owner to connect the source via OAuth in the GUI.

## Query Syntax (Gmail)

- `is:unread` — unread emails
- `from:alice` — emails from Alice
- `newer_than:7d` — emails from the last 7 days
- `subject:report` — emails with "report" in subject
- Combine: `is:unread from:alice newer_than:7d`

## Important Notes

- **Data is filtered**: The owner controls which fields you see. Some fields may be missing or redacted.
- **Actions require approval**: All outbound actions (emails, drafts) go to a staging queue. The owner must approve before execution.
- **Everything is audited**: Every pull and propose is logged with your purpose string.
