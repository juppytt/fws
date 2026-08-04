# HTTP/HTTPS routing through fws

This doc explains what happens when an agent or CLI tool makes an
HTTP/HTTPS request through `fws` — from the moment the request leaves
`curl`/`gh`/`gws` to the moment a mock response comes back. Read this
if you're confused about which mock served which request, or if you're
adding a new fake service that needs to play nicely with the proxy.

## Architecture

### System components

```
┌──────────────┐   HTTP_PROXY /     ┌────────────┐  forward  ┌─────────────┐
│ curl / gh /  │ ───HTTPS_PROXY────▶│ MITM proxy │──────────▶│ Mock server │
│ gws / your   │                    │ localhost: │           │  (Express)  │
│ agent        │ ◀────response──────│    4101    │◀──────────│             │
└──────────────┘                    └────────────┘           └─────────────┘
```

- **`fws server start`** spawns one daemon process containing both
  the **MITM proxy** and the **mock server**.
- The **MITM proxy** is a separate listener inside the same process. Its
  job is to terminate TLS for known/intercepted hosts and forward the
  decrypted HTTP request to the mock server.
- The **mock server** is an Express app containing built-in service routes,
  Git smart HTTP support, the Web Fetch handler, and dynamically registered
  custom services.
- `eval $(fws server env)` points `HTTP_PROXY` and `HTTPS_PROXY` at the MITM
  listener (`http://localhost:4101` by default) and exports `SSL_CERT_FILE` so
  clients trust its local CA.

The proxy environment variables name the **next hop**, not the request's final
destination. A request for `https://api.github.com/user` first connects to
`localhost:4101`; the client then identifies `api.github.com:443` in its
`CONNECT` request, allowing fws to intercept or pass through the original host.
Plain HTTP clients send the full destination URL to the same listener.

> **curl compatibility:** `fws server env` also exports lowercase
> `http_proxy`. curl intentionally ignores uppercase `HTTP_PROXY`, while some
> other clients expect the uppercase form.

The MITM Proxy and Mock Server are two listeners in the same daemon process.
They do not have to be separate. fws uses two listeners to keep proxy networking
(`CONNECT`, TLS termination, and passthrough) out of the Express routing code.
This also lets setup commands and tests call the Mock Server directly.

## MITM Proxy

The proxy makes the network-level routing decision before the request reaches
Express:

```
incoming proxy request
       │
       ▼
┌────────────────────────────────────────────┐
│ Should this host be intercepted?           │
│                                            │
│ built-in host                              │
│ OR Web Fetch fixture exists                │
│ OR custom service is registered            │
└────────────────────────────────────────────┘
       │ yes                         │ no
       ▼                             ▼
┌─────────────────────────┐   ┌─────────────────────────┐
│ Intercept               │   │ Pass through            │
│                         │   │                         │
│ HTTPS: decrypt TLS at   │   │ Connect to real host    │
│ the proxy               │   │                         │
│ HTTPS/HTTP: add         │   │ HTTPS: tunnel encrypted │
│ original-host and       │   │ traffic                 │
│ original-scheme headers │   │ HTTP: forward request   │
│                         │   │ and response            │
└─────────────────────────┘   └─────────────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Forward to Mock Server  │
│ 127.0.0.1:<mockPort>    │
└─────────────────────────┘
```

The pass-through branch never enters the Mock Server. Likewise, an intercepted
request never falls back to the real network after reaching the Mock Server.
For intercepted HTTPS, the client still uses TLS. fws presents a certificate
for the requested host signed by its local CA, and `SSL_CERT_FILE` makes the
client trust that CA. The TLS connection therefore runs between the client and
fws, where the request is decrypted, rather than end to end between the client
and the remote host.

### HTTPS interception and tunneling

1. Client opens a TCP connection to the proxy and sends
   `CONNECT example.com:443 HTTP/1.1`.
2. The proxy decides whether to **intercept** this host or pass it
   through to the real internet. See "Host interception criteria" below.
3. **Pass-through**: the proxy opens a raw TCP connection to the real
   `example.com:443`, replies `200 Connection Established`, and stitches
   the two sockets together. After this point the proxy doesn't see the
   bytes — TLS is end to end with the real server.
4. **Intercept**: the proxy mints a server certificate for `example.com`
   on the fly (signed by fws's local CA), establishes a TLS session with
   the client, decrypts the HTTP request, and forwards it
   over a fresh `http://127.0.0.1:<mockPort>/...` connection to the
   mock server. The proxy attaches two custom headers on this forward,
   described in the next section.
5. Multiple HTTP/1.1 requests on the same TLS socket are supported (the
   proxy doesn't close the socket after one response — see #7 / mitm
   keep-alive).

The staged `gws` discovery documents retain their original Google API URLs, so
regular discovery-backed methods and helper commands both enter this path with
their service hostname and HTTP path intact.

### HTTP forwarding

1. Client sends the request directly to the proxy with an absolute URL
   in the request line: `GET http://example.com/foo HTTP/1.1`.
2. Same intercept-or-passthrough decision as CONNECT.
3. **Pass-through**: forward to the real `example.com:80` over a normal
   `http.request` and stream the response back unchanged.
4. **Intercept**: same as the HTTPS intercept path — forward to the
   mock server with the custom headers.

### Host interception criteria

```
intercept(host) =
       host is a built-in service host
    OR host has at least one Web Fetch fixture in the in-memory store
    OR host is registered as a custom service
```

The **store** is the daemon's in-memory state, not a database. Seed data
initializes it when fws starts; setup commands such as `fws fetch add` mutate
it at runtime, and snapshots can save and restore it.

Built-in services and Web Fetch fixtures both cause interception, but they
describe different kinds of mocks:

| | Built-in service host | Web Fetch fixture |
|---|---|---|
| Defined by | Static host list in fws source code | Seed data, `fws fetch add`, or a snapshot |
| Matching | Service host | Exact URL or host, optionally filtered by method |
| Response | Dedicated Gmail, GitHub, Search, etc. route logic | User-supplied status, headers, and body |
| Changes at runtime | No | Yes |

The built-in service host list lives in `src/proxy/intercepted-hosts.ts` and
contains hosts where fws ships a dedicated mock service:

- `gmail.googleapis.com`, `www.googleapis.com`, `tasks.googleapis.com`,
  `sheets.googleapis.com`, `people.googleapis.com`, `chat.googleapis.com`,
  `docs.googleapis.com`, `slides.googleapis.com`, etc.
- `api.github.com` for REST and GraphQL
- `github.com` for Git smart HTTP clone and fetch

The Web Fetch check is dynamic: any time a user runs `fws fetch add` (or
the proxy starts up with seeded fixtures), every fixture's host becomes
eligible for interception. So adding a fixture for
`https://my-api.test/foo` automatically intercepts any future request to
`my-api.test`.

Custom-service registration is dynamic too. After
`fws service register service.json`, new connections to the definition's
`host` are intercepted without restarting the daemon.

Hosts that match none of these criteria are passed through to the real internet.
This is intentional — fws isn't trying to be a totalizing sandbox by
default. If you want full agent isolation, every host the agent reaches
needs a built-in mock, Web Fetch fixture, or registered custom service.

### Forwarded request metadata

When the proxy forwards an intercepted request, it doesn't just hand the
mock server the path — it also tells the mock which host the original
request was for, via two custom HTTP headers:

```
GET /gmail/v1/users/me/profile HTTP/1.1
Host: 127.0.0.1:4100                       ← rewritten for the mock server
X-Fws-Original-Host: gmail.googleapis.com  ← the host the client typed
X-Fws-Original-Scheme: https               ← whether it was http or https
Authorization: Bearer fake
...
```

`X-Fws-Original-Host` and `X-Fws-Original-Scheme` are fws-specific
headers (the `X-` prefix is the conventional marker for non-standard
custom headers). The proxy adds them to both HTTPS and plain HTTP requests.
In either case it creates a new local HTTP request and rewrites `Host` to the
Mock Server address, so Express would otherwise lose the original destination
host and scheme. The host lets dispatchers distinguish, for example,
`gmail.googleapis.com/foo` from `my-api.test/foo`; the scheme lets Web Fetch
reconstruct the exact canonical URL and distinguish `http://` from `https://`.

These headers are only ever set by the MITM proxy. A direct test fetch
against the mock server (e.g., `h.fetch('/gmail/v1/users/me/profile')`
in a unit test) carries no such header, and the routing layer treats it
as a non-proxied request.

## Mock Server

### Request dispatch order

Once an intercepted request reaches Express, host ownership is resolved before
path matching:

```
incoming proxied request
       │
       ▼
┌────────────────────────────────────────────┐
│ customServiceDispatcher                    │
│                                            │
│ Registered custom service for this host?   │
│   ├─ yes → run its handler or route        │
│   │         (unmatched route → scoped 404) │
│   └─ no  → next()                          │
└────────────────────────────────────────────┘
       │
       ▼
┌────────────────────────────────────────────┐
│ webFetchHostDispatcher                     │
│                                            │
│ X-Fws-Original-Host header?                │
│   ├─ no  → next()                          │
│   ├─ yes, built-in host → next()           │
│   └─ yes, foreign host                     │
│           → webFetchCatchAll               │
└────────────────────────────────────────────┘
       │
       ▼
┌────────────────────────────────────────────┐
│ Built-in service routes                    │
│ Gmail, Calendar, Drive, Tasks, Sheets,     │
│ People, Git smart HTTP, GitHub API, Search │
└────────────────────────────────────────────┘
       │
       ▼
┌────────────────────────────────────────────┐
│ Express default 404                        │
└────────────────────────────────────────────┘
```

`customServiceDispatcher` comes first because registering a custom service
claims that host for the service. If Web Fetch ran first, the custom host would
look like any other foreign host and Web Fetch would consume the request before
the custom service could see it.

`webFetchHostDispatcher` runs before the built-in path routers. This prevents
**path collisions**. For example, a fixture for
`https://random.test/gmail/v1/users/me/profile` must go to Web Fetch rather than
being shadowed by the Gmail route merely because its path starts with
`/gmail/`.

Requests for built-in hosts continue to their dedicated routes. A proxied
request for `gmail.googleapis.com/gmail/v1/users/me/profile` is therefore
handled by `gmailRoutes()`, not Web Fetch. Internal setup and control endpoints
under `/__fws/` are omitted from the diagram because they are normally called
directly rather than through the outbound proxy.

### Built-in services

Built-in hosts are listed in `INTERCEPTED_HOSTS` and continue past both host
dispatchers to dedicated path routers. Google Workspace APIs, GitHub REST and
GraphQL on `api.github.com`, Git smart HTTP on `github.com`, and Search all use
this path. If no built-in route matches, Express returns its default 404.

### Custom services

`fws service register <definition.json>` adds a host-owned mock without adding
a built-in router to the fws codebase. The proxy starts intercepting that host
immediately, and `customServiceDispatcher` sends every request for the host to
the registered declarative routes or Python handler.

Custom services take precedence over Web Fetch for the same host. A declarative
service also owns its misses: if no route matches, it returns a service-scoped
404 instead of falling through to a Web Fetch fixture or built-in path router.
Built-in hosts cannot be registered as custom services.

See [Custom services](custom-services.md) for the definition format, state
transitions, request logs, snapshots, and Python handlers.

### Web Fetch fixtures

When the dispatcher hands a request to `webFetchCatchAll`, the handler:

1. Reconstructs the canonical URL:
   `${X-Fws-Original-Scheme}://${X-Fws-Original-Host}${req.originalUrl}`
2. Looks up a fixture, in order:
   - Exact URL match (with optional method filter)
   - Host-only match (any path on this host)
3. If a fixture matches, writes its `{status, headers, body}` to the
   Express response and returns.
4. If nothing matches, falls back to a hardcoded default response
   (`200 application/json`, `{"mock": true, "source": "fws-web-fetch-default"}`).
   The default is intentionally not user-configurable; if you want
   a specific response for a specific URL, add a fixture for it.

## Routing examples

### Google Workspace API request

```
gws gmail users messages list
   │
   │ HTTPS to gmail.googleapis.com:443
   ▼
MITM proxy CONNECT
   │
   │ host = gmail.googleapis.com → built-in service host → intercept
   │ Decrypt TLS, parse HTTP request
   ▼
Forward to mock server with:
   X-Fws-Original-Host: gmail.googleapis.com
   X-Fws-Original-Scheme: https
   ▼
Dispatcher: header present, host is built-in → next()
   ▼
gmailRoutes() matches `/gmail/v1/users/me/messages` → returns seed messages
```

### Seeded Web Fetch fixture

```
curl https://example.com/
   │
   │ HTTPS_PROXY → CONNECT example.com:443
   ▼
MITM proxy CONNECT
   │
   │ host = example.com → not a built-in service host
   │ but example.com has a fixture → intercept
   │ TLS termination, parse HTTP request
   ▼
Forward to mock server with:
   X-Fws-Original-Host: example.com
   X-Fws-Original-Scheme: https
   ▼
Dispatcher: header present, foreign host → straight to webFetchCatchAll
   ▼
Lookup fixture for https://example.com/ → seeded HTML "Example Domain (mocked)"
```

### Web Fetch path collision

```
fws fetch add --url https://random.test/gmail/v1/users/me/profile --body '{"custom":"yes"}'
curl https://random.test/gmail/v1/users/me/profile
   │
   │ HTTPS_PROXY → CONNECT random.test:443
   ▼
MITM proxy CONNECT
   │
   │ host = random.test → not a built-in service host
   │ but random.test has a fixture → intercept
   ▼
Forward to mock server with:
   X-Fws-Original-Host: random.test
   ▼
Dispatcher: header present, foreign host → straight to webFetchCatchAll
   │  (the gmailRoutes() never sees this request)
   ▼
Lookup fixture for https://random.test/gmail/v1/users/me/profile → returns {"custom":"yes"}
```

### Unmocked host passthrough

```
curl https://nothing-real.invalid/
   │
   │ HTTPS_PROXY → CONNECT nothing-real.invalid:443
   ▼
MITM proxy CONNECT
   │
   │ host = nothing-real.invalid → no built-in, fixture, or custom service
   │ → passthrough
   │ Open raw TCP to the real nothing-real.invalid:443
   ▼
DNS resolution fails (or real server unreachable)
   ▼
curl gets a connection error — there is no mock for this host
```

If you want this case to return a mock instead of failing, add a fixture
or a host-only fixture: `fws fetch add --host nothing-real.invalid --body '...'`.

## Extending fws

### Adding a custom service (no FWS source code change)

Use a custom service when a mock is specific to an experiment or does not need
to ship as part of FWS. Registration does not require modifying or restarting
FWS:

```bash
fws service register service.json
```

The JSON definition provides:

- A host, such as `teams-mcp.test`
- Initial JSON state
- Either declarative routes and state transitions, or a Python handler

After registration, the MITM Proxy immediately starts intercepting the host.
FWS passes the service state to each request handler and stores the returned
state for the next request. Re-registering the same host replaces its
definition and state.

See [Custom services](custom-services.md) for the definition format. Use
`fws service state <host>` and `fws service requests <host>` to inspect a
running service.

### Adding a built-in mock service

Use a built-in service when the mock should be maintained and distributed as
part of FWS. Unlike runtime registration, this requires changing the FWS source
code and adding tests:

1. **Add the host(s) to `INTERCEPTED_HOSTS`** in
   `src/proxy/intercepted-hosts.ts`. The proxy needs to know it should
   terminate TLS for those hosts; otherwise traffic to them passes
   through to the real internet.
2. **Mount your router in `src/server/app.ts`** alongside the existing
   `gmailRoutes()`, `calendarRoutes()`, etc. The order doesn't matter
   between siblings as long as their paths don't overlap. Make sure
   you're mounted **after** `customServiceDispatcher` and
   `webFetchHostDispatcher` so host ownership is resolved before built-in
   path matching.
3. **Don't read `X-Fws-Original-Host` from inside your route**. The
   dispatcher already used it to decide that your route should run; by
   the time the request reaches your handler, the host is implicitly
   a built-in service host. If you genuinely need to discriminate
   by host inside the same router, you have two options: either
   register multiple sub-routers (one per host) or read the header
   yourself, but the simpler thing is usually to put each host in its
   own router file.
