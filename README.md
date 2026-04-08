# fws — Fake Web Services

A local mock server for testing CLI tools and agents against fake web services without real credentials. Supports Google Workspace (`gws` CLI), GitHub (`gh` CLI), and more.

Built with [Claude Code](https://claude.ai/code).

## How it works

fws runs a local HTTP mock server (port 4100) and a MITM CONNECT proxy (port 4101) that intercepts HTTPS traffic to `*.googleapis.com` and `api.github.com`, forwarding it to the mock server.

For `gws`: discovery cache URLs are rewritten to localhost, and `GOOGLE_WORKSPACE_CLI_TOKEN=fake` bypasses auth.
For `gh`: `HTTPS_PROXY` routes traffic through the MITM proxy, and `GH_TOKEN=fake` bypasses auth.

All data lives **in memory**. When the server stops, everything is lost unless you save a snapshot first. Use `fws snapshot save` to persist state.

## Install

```bash
npm install -g @juppytt/fws
```

Or from source:

```bash
git clone https://github.com/juppytt/fws.git && cd fws
npm install && npm link
```

## Quick Start

```bash
# Start the server (runs in background)
fws server start

# Set env vars (printed by the command above)
export GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.local/share/fws/config
export GOOGLE_WORKSPACE_CLI_TOKEN=fake
export HTTPS_PROXY=http://localhost:4101
export SSL_CERT_FILE=~/.local/share/fws/certs/ca.crt
export GH_TOKEN=fake

# Try gws commands
gws gmail +triage
gws calendar events list --params '{"calendarId":"primary"}'
gws drive files list

# Try gh commands
gh issue list                                      # requires GH_REPO=testuser/my-project
gh api /repos/testuser/my-project/issues
gh api /user

# When done
fws server stop
```

The server starts with sample seed data so you can try commands immediately.

## Usage

### Proxy mode (one-shot)

Starts a temporary server, runs gws, exits. No separate server needed.

```bash
fws gmail users messages list --params '{"userId":"me"}'
fws gmail +triage
fws calendar calendarList list
fws drive about get --params '{"fields":"*"}'
```

### Server mode (persistent)

```bash
fws server start                  # Start in background
fws server status                 # Check if running
fws server stop                   # Stop
fws server start --foreground     # Run in foreground (for debugging)
```

### Setup (add data to running server)

```bash
fws setup gmail add-message --from alice@corp.com --subject "Meeting" --body "See you at 3pm"
fws setup calendar add-event --summary "Team sync" --start 2026-04-08T15:00:00 --duration 1h
fws setup drive add-file --name "report.pdf" --mimeType application/pdf
```

### Snapshots

Data is in-memory only. Save before stopping the server if you need to keep it.

```bash
fws snapshot save my-scenario     # Save current state to disk
fws snapshot load my-scenario     # Restore saved state into running server
fws snapshot list                 # List saved snapshots
fws snapshot delete my-scenario   # Delete a snapshot
fws reset                        # Reset to default seed data
fws reset --snapshot my-scenario  # Reset to a specific snapshot
```

Snapshots are stored in `~/.local/share/fws/snapshots/` (override with `FWS_DATA_DIR`).

## Default seed data

| Service  | Data |
|----------|------|
| Gmail    | 5 messages (3 inbox, 1 sent, 1 read), system labels + "Projects" user label |
| Calendar | 4 events (Daily Standup, Q3 Planning, 1:1, Team Lunch) |
| Drive    | 5 files (docs, spreadsheet, image, folder) |
| Tasks    | 1 task list with 2 tasks (1 pending, 1 completed) |
| Sheets   | 1 spreadsheet ("Budget 2026") |
| People   | 2 contacts (Alice, Bob), 1 contact group |
| GitHub   | 1 repo (testuser/my-project), 2 issues, 1 PR, 1 comment |

## API support

**Google Workspace**: Gmail (28/79 + 5 helpers), Calendar (21/37), Drive (18/57), Tasks (14/14), Sheets (7/17), People (16/24).
**GitHub**: REST (repos, issues, PRs, comments, labels, search) + GraphQL (issue/PR list and view).

See [docs/gws-support.md](docs/gws-support.md) for endpoint tables.

## Documentation

- [docs/cli-reference.md](docs/cli-reference.md) — Full CLI reference with all flags, HTTP API equivalents, and examples
- [docs/gws-support.md](docs/gws-support.md) — Google Workspace endpoint support table
- [docs/gh-support.md](docs/gh-support.md) — GitHub endpoint support table

## Structure

```
bin/fws.ts              CLI entry point
src/server/routes/      Gmail, Calendar, Drive, and control API routes
src/store/              In-memory data store + seed data
src/config/             Discovery cache URL rewriting
src/proxy/              MITM proxy for helper commands
test/                   Vitest tests (with gws CLI validation)
docs/                   API support documentation
```
