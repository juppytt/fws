# fws CLI Reference

## Server

### `fws server start`

Start the mock server in the background.

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --port <port>` | Port number | `4100` |
| `-s, --snapshot <name>` | Load a snapshot on start | — |
| `--foreground` | Run in foreground (for debugging) | — |

If a server is already running, it is automatically stopped and restarted.

```bash
fws server start
fws server start -p 5000
fws server start --snapshot my-scenario
```

### `fws server stop`

Stop the running server.

### `fws server status`

Show whether the server is running and on which port.

---

## Setup

Convenience commands to seed data into a running server. The server must be running first (`fws server start`).

### `fws setup gmail add-message`

Add an email message to the mailbox.

| Flag | Required | Description | Default |
|------|----------|-------------|---------|
| `--from <email>` | **yes** | Sender address | — |
| `--to <email>` | no | Recipient address | `testuser@example.com` |
| `--subject <text>` | no | Subject line | `(no subject)` |
| `--body <text>` | no | Message body (plain text) | empty |
| `--labels <list>` | no | Comma-separated label IDs | `INBOX,UNREAD` |
| `-p, --port <port>` | no | Server port | `4100` |

```bash
fws setup gmail add-message --from alice@company.com --subject "Meeting" --body "See you at 3pm"
fws setup gmail add-message --from bot@ci.com --subject "Build failed" --labels INBOX,UNREAD,IMPORTANT
fws setup gmail add-message --from me@example.com --to bob@example.com --subject "Reply" --labels SENT
```

**HTTP API equivalent:**

```bash
curl -X POST http://localhost:4100/__fws/setup/gmail/message \
  -H 'Content-Type: application/json' \
  -d '{"from":"alice@company.com","subject":"Meeting","body":"See you at 3pm","labels":["INBOX","UNREAD"]}'
```

Request body fields:

| Field | Type | Description |
|-------|------|-------------|
| `from` | string | Sender address |
| `to` | string | Recipient address |
| `subject` | string | Subject line |
| `body` | string | Message body |
| `labels` | string[] | Label IDs |
| `date` | string | ISO 8601 date (defaults to now) |

Response: `{ "id": "...", "threadId": "..." }`

---

### `fws setup calendar add-event`

Add a calendar event.

| Flag | Required | Description | Default |
|------|----------|-------------|---------|
| `--summary <text>` | **yes** | Event title | — |
| `--start <datetime>` | **yes** | Start time (ISO 8601) | — |
| `--duration <dur>` | no | Duration: `30m`, `1h`, `2h`, `1d`, etc. | `1h` |
| `--calendar <id>` | no | Calendar ID | `primary` |
| `--location <text>` | no | Location | — |
| `--attendees <list>` | no | Comma-separated attendee emails | — |
| `-p, --port <port>` | no | Server port | `4100` |

End time is computed automatically from `start + duration`.

```bash
fws setup calendar add-event --summary "Standup" --start 2026-04-08T09:00:00
fws setup calendar add-event --summary "Lunch" --start 2026-04-08T12:00:00 --duration 1h --location "Cafeteria"
fws setup calendar add-event --summary "Review" --start 2026-04-08T14:00:00 --duration 30m --attendees alice@co.com,bob@co.com
```

**HTTP API equivalent:**

```bash
curl -X POST http://localhost:4100/__fws/setup/calendar/event \
  -H 'Content-Type: application/json' \
  -d '{"summary":"Standup","start":"2026-04-08T09:00:00Z","duration":"30m"}'
```

Request body fields:

| Field | Type | Description |
|-------|------|-------------|
| `summary` | string | Event title |
| `start` | string | ISO 8601 start time |
| `duration` | string | Duration (`30m`, `1h`, `2h`, `1d`) — default `1h` |
| `description` | string | Event description |
| `location` | string | Location |
| `calendar` | string | Calendar ID (omit for primary) |
| `attendees` | string[] | Attendee email addresses |

Response: `{ "id": "...", "calendarId": "..." }`

---

### `fws setup drive add-file`

Add a file (metadata only) to Drive.

| Flag | Required | Description | Default |
|------|----------|-------------|---------|
| `--name <text>` | **yes** | File name | — |
| `--mimeType <type>` | no | MIME type | `application/octet-stream` |
| `--parent <id>` | no | Parent folder ID | `root` |
| `--size <bytes>` | no | File size in bytes | — |
| `-p, --port <port>` | no | Server port | `4100` |

```bash
fws setup drive add-file --name "report.pdf" --mimeType application/pdf
fws setup drive add-file --name "Project Docs" --mimeType application/vnd.google-apps.folder
fws setup drive add-file --name "notes.txt" --mimeType text/plain --parent folder001 --size 1024
```

**HTTP API equivalent:**

```bash
curl -X POST http://localhost:4100/__fws/setup/drive/file \
  -H 'Content-Type: application/json' \
  -d '{"name":"report.pdf","mimeType":"application/pdf"}'
```

Request body fields:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | File name |
| `mimeType` | string | MIME type |
| `parent` | string | Parent folder ID |
| `size` | number | File size in bytes |
| `description` | string | File description |

Response: `{ "id": "..." }`

---

## Snapshots

All data is in-memory. Snapshots save/restore the full server state to disk.

Stored in `~/.local/share/fws/snapshots/<name>/store.json` (override with `FWS_DATA_DIR`).

### `fws snapshot save <name>`

Save current server state.

### `fws snapshot load <name>`

Replace current server state with a saved snapshot.

### `fws snapshot list`

List all saved snapshots.

### `fws snapshot delete <name>`

Delete a saved snapshot.

---

## Reset

### `fws reset`

Reset server to default seed data.

### `fws reset --snapshot <name>`

Reset server to a specific snapshot.

---

## Proxy mode

Any command that doesn't match a built-in subcommand is forwarded to `gws` through a temporary mock server.

```bash
fws gmail users messages list --params '{"userId":"me"}'
fws drive files list
fws calendar events list --params '{"calendarId":"primary"}'
```

This starts a server, runs the gws command, and exits. No `fws server start` needed.
