# fws — Fake Google Workspace

A local mock server that redirects the `gws` CLI, enabling Gmail/Calendar/Drive API testing without OAuth authentication.

## How it works

gws sends API requests to the `rootUrl` defined in its discovery cache (`~/.config/gws/cache/*.json`). fws rewrites these URLs to `http://localhost:4100/` and sets `GOOGLE_WORKSPACE_CLI_TOKEN=fake` to bypass auth.

## Install

```bash
npm install
```

## Usage

### Proxy mode (one-shot commands)

```bash
npx tsx bin/fws.ts gmail users labels list --params '{"userId":"me"}'
npx tsx bin/fws.ts gmail users messages list --params '{"userId":"me"}'
npx tsx bin/fws.ts calendar calendarList list
npx tsx bin/fws.ts calendar events list --params '{"calendarId":"primary"}'
npx tsx bin/fws.ts drive files list
npx tsx bin/fws.ts drive about get --params '{"fields":"*"}'
```

fws starts a mock server internally, runs gws against it, then exits.

### Server mode (persistent)

```bash
# Start server
npx tsx bin/fws.ts server start

# Seed data
npx tsx bin/fws.ts setup gmail add-message --from alice@corp.com --subject "Meeting agenda" --body "Meeting at 3pm tomorrow"
npx tsx bin/fws.ts setup calendar add-event --summary "Team meeting" --start 2026-04-08T15:00:00 --duration 1h
npx tsx bin/fws.ts setup drive add-file --name "report.pdf" --mimeType application/pdf

# Query with gws directly (in a separate terminal)
export GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.local/share/fws/config
export GOOGLE_WORKSPACE_CLI_TOKEN=fake
gws gmail users messages list --params '{"userId":"me"}'

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

## Tests

```bash
npm test
```

46 tests (Gmail 17, Calendar 15, Drive 12, Snapshot 2). Each test starts a mock server and validates responses through the actual gws CLI.

## Supported APIs

| Service | Endpoints |
|---------|-----------|
| Gmail | messages (list/get/send/delete/trash/modify), labels (CRUD), threads (list/get), profile |
| Calendar | calendarList, calendars (CRUD), events (CRUD, timeMin/timeMax filter, q search) |
| Drive | about, files (list/get/create/patch/delete/copy, q filter) |

## Structure

```
bin/fws.ts              CLI entry point
src/server/routes/      Gmail, Calendar, Drive, and control API routes
src/store/              In-memory data store + seed data
src/config/             Discovery cache URL rewriting
test/                   Vitest tests (with gws CLI validation)
```
