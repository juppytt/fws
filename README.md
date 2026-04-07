# fws — Fake Google Workspace

A local mock server that redirects the `gws` CLI, enabling Gmail/Calendar/Drive API testing without OAuth authentication.

## How it works

gws sends API requests to the `rootUrl` defined in its discovery cache (`~/.config/gws/cache/*.json`). fws rewrites these URLs to `http://localhost:4100/` and sets `GOOGLE_WORKSPACE_CLI_TOKEN=fake` to bypass auth.

## Install

```bash
npm install
```

## Quick Start

```bash
# Start the server
npm start

# In another terminal, paste the export lines printed by the server, then:
gws gmail users messages list --params '{"userId":"me"}'
gws calendar events list --params '{"calendarId":"primary"}'
gws drive files list
```

The server starts with sample seed data (5 emails, 4 calendar events, 5 drive files) so you can try gws commands immediately.

To stop the server, run `npx tsx bin/fws.ts server stop` or press Ctrl+C in the server terminal.

## Usage

### Proxy mode (one-shot commands)

Starts a temporary server, runs gws, exits. No separate server needed.

```bash
npx tsx bin/fws.ts gmail users messages list --params '{"userId":"me"}'
npx tsx bin/fws.ts calendar calendarList list
npx tsx bin/fws.ts drive about get --params '{"fields":"*"}'
```

### Server mode (persistent)

```bash
# Start server
npx tsx bin/fws.ts server start

# Seed additional data
npx tsx bin/fws.ts setup gmail add-message --from alice@corp.com --subject "Meeting agenda" --body "Meeting at 3pm tomorrow"
npx tsx bin/fws.ts setup calendar add-event --summary "Team meeting" --start 2026-04-08T15:00:00 --duration 1h
npx tsx bin/fws.ts setup drive add-file --name "report.pdf" --mimeType application/pdf

# Stop server
npx tsx bin/fws.ts server stop
```

### Snapshots

```bash
npx tsx bin/fws.ts snapshot save my-scenario    # Save current state
npx tsx bin/fws.ts snapshot list                # List snapshots
npx tsx bin/fws.ts reset                        # Reset to seed data
npx tsx bin/fws.ts snapshot load my-scenario    # Restore saved state
npx tsx bin/fws.ts snapshot delete my-scenario  # Delete snapshot
```

## Default seed data

| Service  | Data |
|----------|------|
| Gmail    | 5 messages (3 inbox, 1 sent, 1 read), system labels + "Projects" user label |
| Calendar | 4 events (Daily Standup, Q3 Planning, 1:1, Team Lunch) |
| Drive    | 5 files (docs, spreadsheet, image, folder) |

## Tests

```bash
npm test
```

46 tests (Gmail 17, Calendar 15, Drive 12, Snapshot 2). Each test validates responses through the actual gws CLI.

## Supported APIs

| Service  | Endpoints |
|----------|-----------|
| Gmail    | messages (list/get/send/delete/trash/modify), labels (CRUD), threads (list/get), profile |
| Calendar | calendarList, calendars (CRUD), events (CRUD, timeMin/timeMax filter, q search) |
| Drive    | about, files (list/get/create/patch/delete/copy, q filter) |

## Structure

```
bin/fws.ts              CLI entry point
src/server/routes/      Gmail, Calendar, Drive, and control API routes
src/store/              In-memory data store + seed data
src/config/             Discovery cache URL rewriting
test/                   Vitest tests (with gws CLI validation)
```
