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

### `fws server env`

Print the env-var exports a child process needs to talk to the running daemon
(GOOGLE_WORKSPACE_CLI_CONFIG_DIR, HTTPS_PROXY, SSL_CERT_FILE, GH_TOKEN, etc.).
Use with `eval`:

```bash
fws server start
eval $(fws server env)
gws gmail users messages list --params '{"userId":"me"}'
gh issue list
fws server stop
```

---

## Service data injection

Each service that supports runtime data injection has a top-level command.
Common pattern: `fws <service> add ...`. The server must be running first
(`fws server start`).

### `fws gmail add`

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
fws gmail add --from alice@company.com --subject "Meeting" --body "See you at 3pm"
fws gmail add --from bot@ci.com --subject "Build failed" --labels INBOX,UNREAD,IMPORTANT
fws gmail add --from me@example.com --to bob@example.com --subject "Reply" --labels SENT
```

---

### `fws calendar add`

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
fws calendar add --summary "Standup" --start 2026-04-08T09:00:00
fws calendar add --summary "Lunch" --start 2026-04-08T12:00:00 --duration 1h --location "Cafeteria"
fws calendar add --summary "Review" --start 2026-04-08T14:00:00 --duration 30m --attendees alice@co.com,bob@co.com
```

---

### `fws drive add`

Add a file (metadata only) to Drive.

| Flag | Required | Description | Default |
|------|----------|-------------|---------|
| `--name <text>` | **yes** | File name | — |
| `--mimeType <type>` | no | MIME type | `application/octet-stream` |
| `--parent <id>` | no | Parent folder ID | `root` |
| `--size <bytes>` | no | File size in bytes | — |
| `-p, --port <port>` | no | Server port | `4100` |

```bash
fws drive add --name "report.pdf" --mimeType application/pdf
fws drive add --name "Project Docs" --mimeType application/vnd.google-apps.folder
fws drive add --name "notes.txt" --mimeType text/plain --parent folder001 --size 1024
```

---

### `fws search add`

Add a Custom Search fixture (keywords → results). Used by the Search fake
service that mocks the Google Custom Search JSON API at `/customsearch/v1`.

| Flag | Required | Description |
|------|----------|-------------|
| `--keywords <list>` | **yes** | Comma-separated keywords (case-insensitive substring match against query) |
| `--results <json>` | **yes** | JSON array of `{title, link, displayLink, snippet}` |
| `-p, --port <port>` | no | Server port (default `4100`) |

```bash
fws search add \
  --keywords python,py \
  --results '[{"title":"Python","link":"https://python.org/","displayLink":"python.org","snippet":"The Python language."}]'
```

---

### `fws fetch add`

Add a Web Fetch fixture — a mock for arbitrary HTTP/HTTPS URLs accessed
through the MITM proxy. Adding a fixture for a URL or host automatically
makes that host eligible for proxy interception, so any client routed
through `HTTPS_PROXY` will get the mock back instead of hitting the real
internet.

| Flag | Required | Description | Default |
|------|----------|-------------|---------|
| `--url <url>` | one of url/host | Exact URL to mock (`https://example.com/foo`) | — |
| `--host <host>` | one of url/host | Hostname to mock (matches any path) | — |
| `--method <verb>` | no | HTTP method to filter on (omit for any) | — |
| `--status <code>` | no | Response status code | `200` |
| `--body <text>` | no | Response body | empty |
| `--header <kv...>` | no | Response header in `Name: Value` form (repeatable) | — |
| `-p, --port <port>` | no | Server port | `4100` |

```bash
# Exact URL match
fws fetch add \
  --url https://api.example.com/v1/echo \
  --status 200 \
  --body '{"hello":"world"}' \
  --header 'content-type: application/json'

# Host-only match (any path on this host)
fws fetch add \
  --host blog.example.com \
  --status 200 \
  --body '<h1>Mocked blog</h1>' \
  --header 'content-type: text/html'

# Method-filtered fixture
fws fetch add \
  --url https://api.example.com/v1/submit \
  --method POST \
  --status 201 \
  --body '{"created":true}'
```

---

## Snapshots

All data is in-memory. Snapshots save/restore the full server state to disk.

Stored in `~/.local/share/fws/snapshots/<name>/store.json` (override with
`FWS_DATA_DIR`).

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
