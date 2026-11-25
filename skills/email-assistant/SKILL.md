---
name: email-assistant
description: Draft email responses by pulling context from Gmail through PersonalDataHub
user_invocable: true
---

# Email Assistant

Given a natural language email request, pull relevant data from connected sources through PersonalDataHub, analyze the context, and draft a response.

## Instructions

### 1. Check that this agent is registered

Run `query-hub me` via Bash. It prints this agent's name and permissions.

If it fails because the agent is not registered, ask the owner for a join link from **Settings → Agents** in the PersonalDataHub GUI, then run:

```bash
query-hub join <link> --name <name>
```

### 2. Verify the source is available

Run `query-hub sources`. It lists the sources this agent may read and whether each is connected. If the command says the hub is not running, tell the user to start the server with `npx pdh start`. If `gmail` is missing or not connected, tell the user to grant the permission in Settings → Agents or connect the source in the GUI.

### 3. Parse the user's request

Analyze the user's message to identify:
- **People** — names, email addresses, affiliations (e.g., "Diego@UCSF")
- **Topics** — subjects, keywords, project names (e.g., "proposal", "law school")
- **Time context** — any mentioned timeframes ("last month", "recently")
- **Desired output** — what kind of email to draft (introduction, follow-up, reply, etc.)
- **Missing information** — what needs to be found in email threads or other sources

### 4. Plan the search strategy

Before searching, plan which queries to run and in what order. Think about:
- **Multiple angles** — the same conversation may surface under different queries. Plan 2-4 complementary queries that approach the topic from different angles.
- **Multiple sources** — if the request involves information beyond email (e.g., GitHub issues, documents), plan pulls from those sources too.
- **Broad then narrow** — start with a broad query to understand the landscape, then narrow down with specific queries based on what you find.

Example strategy for "I've been discussing a proposal with Diego@UCSF, we mentioned law school candidates":
1. `from:diego` + `to:diego` — all recent correspondence with Diego
2. `diego proposal` — emails mentioning both Diego and proposal
3. `diego "law school"` — emails mentioning law school in the Diego thread
4. If needed: `"law school" professor candidate` — broader search for candidate discussions

### 5. Execute the searches

Pull data from PersonalDataHub with `query-hub pull`. Make **parallel calls** when queries are independent:

```bash
query-hub pull gmail --purpose "<why>" --query "<query>" --limit 20
```

**Query syntax (Gmail):**
- `from:diego` / `to:diego` — by sender/recipient
- `subject:proposal` — keyword in subject
- `"law school"` — exact phrase
- `newer_than:90d` / `older_than:7d` — time ranges
- `has:attachment` — emails with attachments
- Combine freely: `from:diego subject:proposal newer_than:90d`

**Cross-source pulls:** For non-email sources, change the source argument:
```bash
query-hub pull github --purpose "<why>" --query "<query>" --limit 10
```

**Guidelines:**
- Run 2-4 queries in parallel when they are independent.
- Deduplicate results across queries by `source_item_id` — the same email may appear in multiple query results.
- If the first round of queries doesn't surface enough context, run follow-up queries based on what you learned (names, thread IDs, keywords discovered in the results).
- Each call gets its own audit log entry, so provide a specific `purpose` for each.

### 6. Analyze and synthesize

Review results from all queries and all sources. Extract:
- The conversation thread and its progression
- Key details (names, dates, decisions, open questions)
- Specific information the user asked about (e.g., "candidates we mentioned")
- Thread IDs for reply threading
- Any cross-source connections (e.g., a GitHub issue referenced in an email)

Present a brief summary of what you found to the user before drafting. Include:
- How many emails/items you found across how many queries
- The key context you extracted
- Any gaps (information you couldn't find)

### 7. Compose the draft

Write the email draft based on:
- The context extracted from all sources
- The user's stated intent (introduction, follow-up, etc.)
- Appropriate tone and formality for the context

Show the draft to the user and ask if they'd like any changes.

### 8. Propose the draft through PersonalDataHub

Once the user approves the draft, propose it with `query-hub propose`:

```bash
query-hub propose gmail draft_email --purpose "<why this draft is being created>" \
  --data '{"to": "<recipient>", "subject": "<subject>", "body": "<body>"}'
```

If the email is a reply to an existing thread, include `"in_reply_to": "<threadId>"` in the `--data` JSON.

Tell the user the draft has been proposed and is waiting for their approval in the PersonalDataHub GUI (by default `http://localhost:3000`).

## Important notes

- **All data goes through PersonalDataHub's access control.** The gateway applies the owner's filters and policies. You will only see data the owner has authorized.
- **Drafts require owner approval.** `query-hub propose` stages the draft — it does NOT send. The owner must approve it in the PersonalDataHub GUI.
- **Always state your purpose.** Every pull and propose call requires a `purpose` string that gets logged in the audit trail.
- **Show your work.** Always show the user what you found and what context you extracted before drafting. Transparency is key.
- **Deduplicate across queries.** The same item may appear in multiple query results. Use `source_item_id` to identify duplicates and merge the context.
