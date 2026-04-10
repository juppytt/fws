import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFwsDaemon, type CliHarness } from './helpers/cli-harness.js';

/**
 * E2E coverage for the Search fake service against the real
 * `fws server start` daemon.
 *
 * Two paths are exercised:
 *  1. Direct HTTP to the daemon's `/customsearch/v1` route — confirms the
 *     route is wired into the daemon's Express app and the seed data is
 *     reachable.
 *  2. `curl` against `https://www.googleapis.com/customsearch/v1` through
 *     the MITM proxy — confirms the proxy intercepts `www.googleapis.com`
 *     traffic and forwards it to the local route. This is the path real
 *     callers (Google API client libraries, custom search-cse SDK, anything
 *     that uses HTTPS_PROXY) actually take.
 */
describe('e2e: Search fake service against real daemon', () => {
  let h: CliHarness;

  beforeAll(async () => {
    h = await startFwsDaemon();
  });

  afterAll(async () => {
    await h.stop();
  });

  // ===== Direct HTTP to the daemon =====

  describe('direct HTTP', () => {
    it('returns 400 when q is missing', async () => {
      const res = await h.fetch('/customsearch/v1?cx=abc');
      expect(res.status).toBe(400);
    });

    it('returns fixture results for matching keyword', async () => {
      const res = await h.fetch('/customsearch/v1?q=learn+typescript&cx=abc');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.kind).toBe('customsearch#search');
      expect(data.items.length).toBeGreaterThan(0);
      expect(data.items[0].link).toContain('typescriptlang.org');
    });

    it('falls back to default results when no keyword matches', async () => {
      const res = await h.fetch('/customsearch/v1?q=zzz_no_match_xyz&cx=abc');
      const data = await res.json();
      expect(data.items[0].displayLink).toBe('example.com');
    });

    it('respects num + start pagination', async () => {
      const r1 = await h.fetch('/customsearch/v1?q=typescript&cx=abc&num=1&start=1');
      const r2 = await h.fetch('/customsearch/v1?q=typescript&cx=abc&num=1&start=2');
      const d1 = await r1.json();
      const d2 = await r2.json();
      expect(d1.items[0].link).not.toBe(d2.items[0].link);
    });

    it('accepts a runtime fixture via setup endpoint', async () => {
      const setup = await h.fetch('/__fws/setup/search/fixture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: ['e2emagic'],
          results: [
            {
              title: 'E2E Magic',
              link: 'https://e2e.magic.test/',
              displayLink: 'e2e.magic.test',
              snippet: 'e2e injected fixture',
            },
          ],
        }),
      });
      expect(setup.status).toBe(200);

      const res = await h.fetch('/customsearch/v1?q=e2emagic&cx=abc');
      const data = await res.json();
      expect(data.items[0].link).toBe('https://e2e.magic.test/');
    });
  });

  // ===== Through the MITM proxy (real client path) =====

  describe('through MITM proxy', () => {
    it('curl reaches the route via https://www.googleapis.com', async () => {
      // www.googleapis.com is in the proxy's intercept list, so this curl
      // gets routed to the local /customsearch/v1 handler instead of the
      // real Google API.
      const { stdout, stderr, exitCode } = await h.run('curl', [
        '-sf',
        '--proxy', `http://localhost:${h.proxyPort}`,
        '--cacert', h.caPath,
        'https://www.googleapis.com/customsearch/v1?q=python&cx=abc',
      ]);
      expect(exitCode, `curl stderr: ${stderr}`).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.kind).toBe('customsearch#search');
      expect(data.items[0].displayLink).toBe('www.python.org');
    });

    it('multiple curl requests reuse the proxy correctly', async () => {
      // Two separate curl invocations — each opens its own CONNECT tunnel,
      // so this is more of a smoke test than a keep-alive check (which
      // mitm-keepalive.e2e.test.ts already covers explicitly).
      const queries = ['typescript', 'python', 'weather'];
      for (const q of queries) {
        const { stdout, exitCode } = await h.run('curl', [
          '-sf',
          '--proxy', `http://localhost:${h.proxyPort}`,
          '--cacert', h.caPath,
          `https://www.googleapis.com/customsearch/v1?q=${q}&cx=abc`,
        ]);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.items.length).toBeGreaterThan(0);
      }
    });

    it('returns 400 through the proxy for missing q', async () => {
      // curl -f makes 4xx exit non-zero, so use plain curl and inspect status
      const { stdout, exitCode } = await h.run('curl', [
        '-s',
        '-o', '/dev/null',
        '-w', '%{http_code}',
        '--proxy', `http://localhost:${h.proxyPort}`,
        '--cacert', h.caPath,
        'https://www.googleapis.com/customsearch/v1?cx=abc',
      ]);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('400');
    });
  });
});
