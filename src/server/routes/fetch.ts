import { Router, type RequestHandler } from 'express';
import { getStore } from '../../store/index.js';
import type { WebFetchFixture, WebFetchResponse } from '../../store/types.js';

/**
 * Web Fetch — generic HTTP/HTTPS mocking for arbitrary URLs.
 *
 * Two integration paths:
 *
 *   1. Direct API: `GET /__fws/fetch?url=...&method=GET` returns the matched
 *      fixture as JSON metadata. Useful for programmatic checks and tests
 *      that don't want to spin up the proxy.
 *
 *   2. MITM proxy catch-all: when the MITM proxy intercepts a host (either
 *      because it's in the built-in allowlist OR because the host has at
 *      least one Web Fetch fixture) and forwards the request here, the
 *      proxy adds an `X-Fws-Original-Host` header. After all the explicit
 *      service routes (gmail, github, etc.) have had a chance to match,
 *      `webFetchCatchAll` serves a fixture (or the hardcoded default).
 *
 * Setup endpoint (called by `fws fetch add`, not user-facing as curl):
 *
 *   POST /__fws/setup/fetch/fixture — add a fixture
 */

/**
 * Hardcoded default response for the case where a host got intercepted
 * (because some other path on it has a fixture) but the specific request
 * URL has no matching fixture. Just gives the client *something* back so
 * the failure mode is "got a generic mock body" rather than "request hung".
 * This is intentionally not user-configurable — see the design discussion
 * around the simplification of Web Fetch.
 */
const HARDCODED_DEFAULT: WebFetchResponse = {
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ mock: true, source: 'fws-web-fetch-default' }),
};

export function webFetchRoutes(): Router {
  const r = Router();

  // Direct API: look up a URL without going through the proxy.
  r.get('/__fws/fetch', (req, res) => {
    const url = String(req.query.url ?? '');
    const method = String(req.query.method ?? 'GET').toUpperCase();
    if (!url) {
      return res.status(400).json({ error: 'url query parameter is required' });
    }
    const lookup = lookupFixture(url, method);
    res.json({
      url,
      method,
      matched: lookup.matched,
      fixture: lookup.fixture ?? null,
      response: lookup.response,
    });
  });

  // Setup: add a fixture at runtime. Called by `fws fetch add`.
  r.post('/__fws/setup/fetch/fixture', (req, res) => {
    const store = getStore();
    const body = req.body || {};
    if (!body.url && !body.host) {
      return res.status(400).json({ error: 'fixture must specify url or host' });
    }
    if (!body.response || typeof body.response.status !== 'number' || typeof body.response.body !== 'string') {
      return res.status(400).json({ error: 'fixture.response must include status (number) and body (string)' });
    }
    const fixture: WebFetchFixture = {
      url: body.url,
      host: body.host,
      method: body.method ? String(body.method).toUpperCase() : undefined,
      response: {
        status: body.response.status,
        headers: body.response.headers,
        body: body.response.body,
      },
    };
    store.webFetch.fixtures.push(fixture);
    res.json({ status: 'added', count: store.webFetch.fixtures.length });
  });

  return r;
}

/**
 * Catch-all middleware. Registered AFTER all the explicit service routes.
 * When the MITM proxy intercepts a host and forwards it here with
 * `X-Fws-Original-Host`, this responds with a fixture (or the hardcoded
 * default). Requests without that header are direct test fetches and
 * fall through to Express's default 404.
 */
export function webFetchCatchAll(): RequestHandler {
  return (req, res, next) => {
    const originalHost = req.header('x-fws-original-host');
    if (!originalHost) {
      return next();
    }

    const scheme = req.header('x-fws-original-scheme') || 'https';
    const url = `${scheme}://${originalHost}${req.originalUrl}`;
    const method = req.method.toUpperCase();

    const { response } = lookupFixture(url, method);

    if (response.headers) {
      for (const [k, v] of Object.entries(response.headers)) {
        res.setHeader(k, v);
      }
    }
    res.status(response.status).send(response.body);
  };
}

/**
 * Used by the MITM proxy to decide whether to intercept a host: if any
 * fixture in the store covers this host (either via host= or via the host
 * portion of url=), the proxy intercepts that host alongside the built-in
 * service allowlist.
 */
export function hasFixtureForHost(hostname: string): boolean {
  try {
    const store = getStore();
    return store.webFetch.fixtures.some(fix => {
      if (fix.host === hostname) return true;
      if (fix.url) {
        try {
          return new URL(fix.url).host === hostname;
        } catch {
          return false;
        }
      }
      return false;
    });
  } catch {
    return false;
  }
}

interface LookupResult {
  matched: 'url' | 'host' | 'default';
  fixture: WebFetchFixture | null;
  response: WebFetchResponse;
}

function lookupFixture(url: string, method: string): LookupResult {
  const store = getStore();
  const upperMethod = method.toUpperCase();

  let host: string | undefined;
  try {
    host = new URL(url).host;
  } catch {
    // not parseable — host-only matches won't fire
  }

  // 1. Exact URL match (with optional method filter)
  for (const fix of store.webFetch.fixtures) {
    if (!fix.url) continue;
    if (fix.url !== url) continue;
    if (fix.method && fix.method.toUpperCase() !== upperMethod) continue;
    return { matched: 'url', fixture: fix, response: fix.response };
  }

  // 2. Host-only match
  if (host) {
    for (const fix of store.webFetch.fixtures) {
      if (!fix.host) continue;
      if (fix.host !== host) continue;
      if (fix.method && fix.method.toUpperCase() !== upperMethod) continue;
      return { matched: 'host', fixture: fix, response: fix.response };
    }
  }

  // 3. Hardcoded default
  return { matched: 'default', fixture: null, response: HARDCODED_DEFAULT };
}
