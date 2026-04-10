import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers/harness.js';

describe('Web Fetch (generic HTTP/HTTPS mock)', () => {
  let h: TestHarness;

  beforeAll(async () => {
    h = await createTestHarness();
  });

  afterAll(async () => {
    await h.cleanup();
  });

  describe('GET /__fws/fetch direct API', () => {
    it('returns 400 when url is missing', async () => {
      const res = await h.fetch('/__fws/fetch');
      expect(res.status).toBe(400);
    });

    it('returns the seeded example.com fixture as exact-url match', async () => {
      const res = await h.fetch('/__fws/fetch?url=' + encodeURIComponent('https://example.com/'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.matched).toBe('url');
      expect(data.response.status).toBe(200);
      expect(data.response.body).toContain('Example Domain (mocked)');
    });

    it('returns the seeded httpbin.org fixture as host match', async () => {
      const res = await h.fetch('/__fws/fetch?url=' + encodeURIComponent('https://httpbin.org/get'));
      const data = await res.json();
      expect(data.matched).toBe('host');
      const body = JSON.parse(data.response.body);
      expect(body.mock).toBe(true);
    });

    it('returns the hardcoded default for unmatched hosts', async () => {
      const res = await h.fetch('/__fws/fetch?url=' + encodeURIComponent('https://random.example.test/foo'));
      const data = await res.json();
      expect(data.matched).toBe('default');
      const body = JSON.parse(data.response.body);
      expect(body.source).toBe('fws-web-fetch-default');
    });
  });

  describe('runtime fixture injection', () => {
    it('accepts a fixture via /__fws/setup/fetch/fixture', async () => {
      const setup = await h.fetch('/__fws/setup/fetch/fixture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://api.test.local/v1/foo',
          response: {
            status: 201,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ injected: true }),
          },
        }),
      });
      expect(setup.status).toBe(200);

      const res = await h.fetch('/__fws/fetch?url=' + encodeURIComponent('https://api.test.local/v1/foo'));
      const data = await res.json();
      expect(data.matched).toBe('url');
      expect(data.response.status).toBe(201);
      expect(JSON.parse(data.response.body).injected).toBe(true);
    });

    it('rejects fixtures missing url and host', async () => {
      const res = await h.fetch('/__fws/setup/fetch/fixture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: { status: 200, body: 'x' } }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects fixtures with malformed response', async () => {
      const res = await h.fetch('/__fws/setup/fetch/fixture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://x.test/', response: { body: 'no status' } }),
      });
      expect(res.status).toBe(400);
    });

    it('respects method filter on a fixture', async () => {
      await h.fetch('/__fws/setup/fetch/fixture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://method.test/',
          method: 'POST',
          response: { status: 200, body: 'post-only' },
        }),
      });

      const get = await h.fetch('/__fws/fetch?url=' + encodeURIComponent('https://method.test/') + '&method=GET');
      const getData = await get.json();
      // GET doesn't match the POST-only fixture → falls through to default
      expect(getData.matched).toBe('default');

      const post = await h.fetch('/__fws/fetch?url=' + encodeURIComponent('https://method.test/') + '&method=POST');
      const postData = await post.json();
      expect(postData.matched).toBe('url');
      expect(postData.response.body).toBe('post-only');
    });
  });

  describe('catch-all middleware (simulated proxy headers)', () => {
    beforeAll(async () => {
      // Earlier tests injected fixtures; reset to seed so the catch-all
      // assertions about default behavior are predictable.
      await h.fetch('/__fws/reset', { method: 'POST' });
    });

    it('does NOT trigger without X-Fws-Original-Host', async () => {
      const res = await h.fetch('/some/random/path/that/no/route/handles');
      expect(res.status).toBe(404);
    });

    it('triggers with X-Fws-Original-Host and serves the matched fixture', async () => {
      const res = await h.fetch('/', {
        headers: {
          'x-fws-original-host': 'example.com',
          'x-fws-original-scheme': 'https',
        },
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('Example Domain (mocked)');
    });

    it('returns the hardcoded default for an intercepted host without a matching fixture', async () => {
      // example.com has a fixture for /, so the host gets intercepted, but
      // a request for /some/other/path on the same host has no fixture →
      // hardcoded default fires.
      const res = await h.fetch('/some/other/path', {
        headers: {
          'x-fws-original-host': 'example.com',
          'x-fws-original-scheme': 'https',
        },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.source).toBe('fws-web-fetch-default');
    });

    it('does NOT shadow real routes when intercepted host happens to match an existing path', async () => {
      // Even with the original-host header set, if a real route matches
      // the path, that route still wins (the catch-all only fires when no
      // other route handled the request). This is the known path-collision
      // limitation; documented separately.
      const res = await h.fetch('/customsearch/v1?q=python&cx=abc', {
        headers: { 'x-fws-original-host': 'www.googleapis.com' },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.kind).toBe('customsearch#search');
    });
  });
});
