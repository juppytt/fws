# How fws routes outbound HTTP traffic

This doc explains, end to end, what happens when an agent or CLI tool
makes an HTTP/HTTPS request through `fws` — from the moment the request
leaves `curl`/`gh`/`gws` to the moment a mock response comes back. Read
this if you're confused about which mock served which request, or if
you're adding a new fake service that needs to play nicely with the
proxy.

## The actors

```
┌──────────────┐    HTTPS_PROXY/    ┌────────────┐  forward  ┌─────────────┐
│ curl / gh /  │ ───────HTTP_PROXY──▶│ MITM proxy │──────────▶│ Mock server │
│ gws / your   │                     │  (mitm.ts) │           │  (Express)  │
│ agent        │ ◀────response───────│            │◀──────────│             │
└──────────────┘                     └────────────┘           └─────────────┘
```

- **`fws server start`** spawns one daemon process containing both
  the **MITM proxy** and the **mock server**.
- The **mock server** is an Express app with one router per fake
  service (`gmail`, `calendar`, `drive`, `tasks`, `sheets`, `people`,
  `github`, `search`, `webFetch`).
- The **MITM proxy** is a separate listener inside the same process. Its
  job is to terminate TLS for known/intercepted hosts and forward the
  decrypted HTTP request to the mock server.
- `eval $(fws server env)` exports `HTTPS_PROXY`, `HTTP_PROXY`, and
  `SSL_CERT_FILE` so your subsequent shell commands route through the
  proxy and trust the proxy's CA.

## What the proxy does on each connection

### HTTPS (CONNECT tunnel)

1. Client opens a TCP connection to the proxy and sends
   `CONNECT example.com:443 HTTP/1.1`.
2. The proxy decides whether to **intercept** this host or pass it
   through to the real internet. (See "Intercept rule" below.)
3. **Pass-through**: the proxy opens a raw TCP connection to the real
   `example.com:443`, replies `200 Connection Established`, and stitches
   the two sockets together. After this point the proxy doesn't see the
   bytes — TLS is end to end with the real server.
4. **Intercept**: the proxy mints a server certificate for `example.com`
   on the fly (signed by fws's local CA), terminates TLS itself, then
   reads the inner HTTP request out of the TLS socket and forwards it
   over a fresh `http://localhost:<mockPort>/...` connection to the
   mock server. The proxy attaches two custom headers on this forward,
   described in the next section.
5. Multiple HTTP/1.1 requests on the same TLS socket are supported (the
   proxy doesn't close the socket after one response — see #7 / mitm
   keep-alive).

### Plain HTTP

1. Client sends the request directly to the proxy with an absolute URL
   in the request line: `GET http://example.com/foo HTTP/1.1`.
2. Same intercept-or-passthrough decision as CONNECT.
3. **Pass-through**: forward to the real `example.com:80` over a normal
   `http.request` and stream the response back unchanged.
4. **Intercept**: same as the HTTPS intercept path — forward to the
   mock server with the custom headers.

### The intercept rule

```
intercept(host) =
       host is in the built-in service allowlist
    OR host has at least one Web Fetch fixture in the store
```

The built-in allowlist lives in `src/proxy/intercepted-hosts.ts` and is
the set of hosts where fws ships a dedicated mock service:

- `gmail.googleapis.com`, `www.googleapis.com`, `tasks.googleapis.com`,
  `sheets.googleapis.com`, `people.googleapis.com`, `chat.googleapis.com`,
  `docs.googleapis.com`, `slides.googleapis.com`, etc.
- `api.github.com`

The Web Fetch check is dynamic: any time a user runs `fws fetch add` (or
the proxy starts up with seeded fixtures), every fixture's host becomes
eligible for interception. So adding a fixture for
`https://my-api.test/foo` automatically intercepts any future request to
`my-api.test`.

Hosts that match neither rule are passed through to the real internet.
This is intentional — fws isn't trying to be a totalizing sandbox by
default. If you want full agent isolation, every host the agent reaches
needs to have either a built-in mock or a Web Fetch fixture.

## What the mock server sees

When the proxy forwards an intercepted request, it doesn't just hand the
mock server the path — it also tells the mock which host the original
request was for, via two custom HTTP headers:

```
GET /gmail/v1/users/me/profile HTTP/1.1
Host: localhost:4100                       ← rewritten so Express is happy
X-Fws-Original-Host: gmail.googleapis.com  ← the host the client typed
X-Fws-Original-Scheme: https               ← whether it was http or https
Authorization: Bearer fake
...
```

`X-Fws-Original-Host` and `X-Fws-Original-Scheme` are fws-specific
headers (the `X-` prefix is the conventional marker for non-standard
custom headers). They exist because Express routes the request based on
path alone, so without these markers the mock server has no way to
distinguish between, say, `gmail.googleapis.com/foo` and
`my-api.test/foo`. The Web Fetch lookup needs the original host to
reconstruct the canonical URL.

These headers are only ever set by the MITM proxy. A direct test fetch
against the mock server (e.g., `h.fetch('/gmail/v1/users/me/profile')`
in a unit test) carries no such header, and the routing layer treats it
as a non-proxied request.

## How the mock server picks a handler

```
incoming request
       │
       ▼
┌───────────────────────────────────────────┐
│ webFetchHostDispatcher (runs FIRST)       │
│                                           │
│ X-Fws-Original-Host header?               │
│   ├─ no  → next() (normal routing)        │
│   ├─ yes, allowlisted host                │
│   │       (gmail.googleapis.com etc.)     │
│   │       → next() (let service routes    │
│   │                  handle it)           │
│   └─ yes, foreign host (my-api.test)      │
│           → straight to webFetchCatchAll  │
└───────────────────────────────────────────┘
       │
       ▼  (only if dispatcher called next())
┌──────────────────────────────┐
│ Service routes               │
│   gmailRoutes()              │
│   calendarRoutes()           │
│   driveRoutes()              │
│   tasksRoutes()              │
│   sheetsRoutes()             │
│   peopleRoutes()             │
│   githubRoutes()             │
│   searchRoutes()             │
│   webFetchRoutes()           │
└──────────────────────────────┘
       │
       ▼  (only if no service route matched)
┌──────────────────────────────┐
│ Express default 404          │
└──────────────────────────────┘
```

The dispatcher is the small but important piece that prevents
**path collisions**. Without it, a fixture for
`https://random.test/gmail/v1/users/me/profile` would be silently
shadowed by the gmail route, because Express would match the path
`/gmail/v1/users/me/profile` against the gmail route before the Web
Fetch handler ever ran. With the dispatcher in front, foreign-host
requests are handed to Web Fetch immediately and the gmail route never
gets a chance to swallow them.

The flip side: requests for **allowlisted** service hosts (the real
APIs that fws ships dedicated mocks for) still go to their service
routes. A proxied request for `gmail.googleapis.com/gmail/v1/users/me/profile`
is handled by `gmailRoutes()`, not by Web Fetch. This is the intended
behavior — fws's dedicated mocks know how to return the right shape
of response for those specific APIs.

## What the Web Fetch handler does

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

## Example walkthroughs

### 1. `gws gmail users messages list`

```
gws gmail users messages list
   │
   │ HTTPS to gmail.googleapis.com:443
   ▼
MITM proxy CONNECT
   │
   │ host = gmail.googleapis.com → in allowlist → intercept
   │ TLS termination, parse HTTP request
   ▼
Forward to mock server with:
   X-Fws-Original-Host: gmail.googleapis.com
   X-Fws-Original-Scheme: https
   ▼
Dispatcher: header present, host is allowlisted → next()
   ▼
gmailRoutes() matches `/gmail/v1/users/me/messages` → returns seed messages
```

### 2. `curl https://example.com/` (with the seeded Web Fetch fixture)

```
curl https://example.com/
   │
   │ HTTPS_PROXY → CONNECT example.com:443
   ▼
MITM proxy CONNECT
   │
   │ host = example.com → not in allowlist
   │ but example.com has a fixture → intercept
   │ TLS termination, parse HTTP request
   ▼
Forward to mock server with:
   X-Fws-Original-Host: example.com
   X-Fws-Original-Scheme: https
   ▼
Dispatcher: header present, host NOT in allowlist → straight to webFetchCatchAll
   ▼
Lookup fixture for https://example.com/ → seeded HTML "Example Domain (mocked)"
```

### 3. `curl https://random.test/gmail/v1/users/me/profile` (path collision)

```
fws fetch add --url https://random.test/gmail/v1/users/me/profile --body '{"custom":"yes"}'
curl https://random.test/gmail/v1/users/me/profile
   │
   │ HTTPS_PROXY → CONNECT random.test:443
   ▼
MITM proxy CONNECT
   │
   │ host = random.test → not in allowlist
   │ but random.test has a fixture → intercept
   ▼
Forward to mock server with:
   X-Fws-Original-Host: random.test
   ▼
Dispatcher: header present, host NOT in allowlist → straight to webFetchCatchAll
   │  (the gmailRoutes() never sees this request)
   ▼
Lookup fixture for https://random.test/gmail/v1/users/me/profile → returns {"custom":"yes"}
```

### 4. `curl https://nothing-real.invalid/` (no fixture, no allowlist)

```
curl https://nothing-real.invalid/
   │
   │ HTTPS_PROXY → CONNECT nothing-real.invalid:443
   ▼
MITM proxy CONNECT
   │
   │ host = nothing-real.invalid → not in allowlist, no fixture → passthrough
   │ Open raw TCP to the real nothing-real.invalid:443
   ▼
DNS resolution fails (or real server unreachable)
   ▼
curl gets a connection error — there is no mock for this host
```

If you want this case to return a mock instead of failing, add a fixture
or a host-only fixture: `fws fetch add --host nothing-real.invalid --body '...'`.

## Adding a new fake service that plays nice with the proxy

Three things to remember:

1. **Add the host(s) to `INTERCEPTED_HOSTS`** in
   `src/proxy/intercepted-hosts.ts`. The proxy needs to know it should
   terminate TLS for those hosts; otherwise traffic to them passes
   through to the real internet.
2. **Mount your router in `src/server/app.ts`** alongside the existing
   `gmailRoutes()`, `calendarRoutes()`, etc. The order doesn't matter
   between siblings as long as their paths don't overlap. Make sure
   you're mounted **after** `webFetchHostDispatcher` so dispatcher gets
   the first look at every request.
3. **Don't read `X-Fws-Original-Host` from inside your route**. The
   dispatcher already used it to decide that your route should run; by
   the time the request reaches your handler, the host is implicitly
   "an allowlisted service host". If you genuinely need to discriminate
   by host inside the same router, you have two options: either
   register multiple sub-routers (one per host) or read the header
   yourself, but the simpler thing is usually to put each host in its
   own router file.
