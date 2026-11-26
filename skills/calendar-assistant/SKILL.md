---
name: calendar-assistant
description: Manage your Google Calendar by checking availability and scheduling events through PersonalDataHub
user_invocable: true
---

# Calendar Assistant

Help users manage their schedule by checking for conflicts, listing upcoming events, and proposing new calendar items.

## Instructions

### 1. Check that this agent is registered

Run `query-hub me` via Bash. It prints this agent's name and permissions.

If it fails because the agent is not registered, ask the owner for a join link from **Settings → Agents** in the PersonalDataHub GUI, then run:

```bash
query-hub join <link> --name <name>
```

### 2. Verify the source is available

Run `query-hub sources`. It lists the sources this agent may read and whether each is connected. If the command says the hub is not running, tell the user to start the server with `npx pdh start`. If `google_calendar` is missing or not connected, tell the user to grant the permission in Settings → Agents or connect the source in the GUI.

### 3. Parse the user's request

Analyze the user's message to identify:
- **Intent** — list events, check availability, create a new event, update/delete an existing one.
- **Time context** — specific dates, relative times ("next Tuesday", "tomorrow afternoon").
- **Event details** — title, description, location, attendees.
- **Missing information** — required fields like start time, duration, or participant emails.

### 4. Plan the search strategy

Before scheduling or responding, check existing commitments. Plan queries for:
- **Current schedule** — Pull events for the relevant time range to check for overlaps.
- **Contextual data** — If the meeting relates to an email thread or GitHub issue, pull that data for context (titles, participants).

### 5. Execute the searches (Pull)

Pull calendar data from PersonalDataHub:

```bash
query-hub pull google_calendar --purpose "Checking availability for <context>" --query "<optional_search_term>" --limit 20
```

**Guidelines:**
- `query-hub pull` takes `--query` and `--limit` only. It has no time-range option. Events come back in start-time order, beginning at the owner's configured start date (7 days ago if none is set). Raise `--limit` if needed and pick out the relevant times yourself.
- If checking a specific day, look at every returned event that falls in that 24h window.
- Deduplicate results if running multiple queries.

### 6. Analyze and synthesize

Review the retrieved events:
- Identify free slots.
- Note any direct conflicts.
- Extract event IDs if the user wants to update or delete a specific item.

Present a summary of the current schedule or the proposed time to the user.

### 7. Propose Actions

Calendar modifications require user approval. Propose them with `query-hub propose`.

#### Create an Event:
```bash
query-hub propose google_calendar create_event --purpose "Scheduling <title> as requested by user" \
  --data '{
    "title": "<summary>",
    "body": "<description>",
    "location": "<location>",
    "start": "<iso_timestamp>",
    "end": "<iso_timestamp>",
    "timeZone": "UTC",
    "attendees": [{"email": "user@example.com"}]
  }'
```

#### Update an Event:
```bash
query-hub propose google_calendar update_event --purpose "Updating event title" \
  --data '{"eventId": "<id>", "title": "<new_summary>"}'
```

#### Delete an Event:
```bash
query-hub propose google_calendar delete_event --purpose "Deleting cancelled event" \
  --data '{"eventId": "<id>"}'
```

### 8. Finalize

Tell the user the action has been proposed and is waiting for their approval in the PersonalDataHub GUI (by default `http://localhost:3000`).

## Important notes

- **All data goes through PersonalDataHub's access control.** You will only see events the owner has authorized.
- **Modifications require owner approval.** `query-hub propose` stages the change — it does NOT immediately update the calendar.
- **Always provide a clear `purpose`.** Every pull and propose is audited.
- **Show your work.** List the events you found that led to your recommendation or time suggestion.
