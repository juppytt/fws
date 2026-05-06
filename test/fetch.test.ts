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

    it('round-trips a base64-encoded binary fixture through the catch-all', async () => {
      // 4 bytes of binary data that aren't valid UTF-8
      const binaryBuf = Buffer.from([0x00, 0x01, 0xff, 0xfe]);
      const b64 = binaryBuf.toString('base64');

      const setup = await h.fetch('/__fws/setup/fetch/fixture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://binary.test/image.png',
          response: {
            status: 200,
            headers: { 'content-type': 'image/png' },
            body: b64,
            bodyEncoding: 'base64',
          },
        }),
      });
      expect(setup.status).toBe(200);

      // Direct API returns the raw fixture metadata (body stays base64)
      const meta = await h.fetch(
        '/__fws/fetch?url=' + encodeURIComponent('https://binary.test/image.png'),
      );
      const metaData = await meta.json();
      expect(metaData.matched).toBe('url');
      expect(metaData.response.bodyEncoding).toBe('base64');
      expect(metaData.response.body).toBe(b64);

      // Catch-all (proxy path) decodes to real binary
      const res = await h.fetch('/image.png', {
        headers: {
          'x-fws-original-host': 'binary.test',
          'x-fws-original-scheme': 'https',
        },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      const arrayBuf = await res.arrayBuffer();
      expect(Buffer.from(arrayBuf)).toEqual(binaryBuf);
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

    it('matches fixtures regardless of trailing slash on the path', async () => {
      // Register without trailing slash, look up with one.
      await h.fetch('/__fws/setup/fetch/fixture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://slash.test/page',
          response: { status: 200, headers: { 'content-type': 'text/plain' }, body: 'page-no-slash' },
        }),
      });

      const exact = await h.fetch('/__fws/fetch?url=' + encodeURIComponent('https://slash.test/page'));
      expect((await exact.json()).matched).toBe('url');

      const trailing = await h.fetch('/__fws/fetch?url=' + encodeURIComponent('https://slash.test/page/'));
      const trailingData = await trailing.json();
      expect(trailingData.matched).toBe('url');
      expect(trailingData.response.body).toBe('page-no-slash');

      // Inverse: register with trailing slash, look up without.
      await h.fetch('/__fws/setup/fetch/fixture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://slash.test/dir/',
          response: { status: 200, headers: { 'content-type': 'text/plain' }, body: 'dir-with-slash' },
        }),
      });

      const noSlash = await h.fetch('/__fws/fetch?url=' + encodeURIComponent('https://slash.test/dir'));
      const noSlashData = await noSlash.json();
      expect(noSlashData.matched).toBe('url');
      expect(noSlashData.response.body).toBe('dir-with-slash');
    });

    it('preserves the root "/" path when canonicalizing', async () => {
      await h.fetch('/__fws/setup/fetch/fixture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://root-slash.test/',
          response: { status: 200, body: 'root' },
        }),
      });

      const withSlash = await h.fetch('/__fws/fetch?url=' + encodeURIComponent('https://root-slash.test/'));
      expect((await withSlash.json()).matched).toBe('url');

      const noSlash = await h.fetch('/__fws/fetch?url=' + encodeURIComponent('https://root-slash.test'));
      expect((await noSlash.json()).matched).toBe('url');
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

    it('allowlisted service host: real service route still handles the request', async () => {
      // www.googleapis.com is in the built-in service allowlist, so the
      // dispatcher lets it fall through to the normal routing chain and
      // the search route handles it. This is the desirable behavior — a
      // proxied gmail / search / github request should be served by its
      // dedicated mock, not by the Web Fetch catch-all.
      const res = await h.fetch('/customsearch/v1?q=python&cx=abc', {
        headers: { 'x-fws-original-host': 'www.googleapis.com' },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.kind).toBe('customsearch#search');
    });

    it('foreign host: fixture wins on path collision with a real service route (gh#15)', async () => {
      // Regression for gh#15. Without the host dispatcher, this fixture
      // would be shadowed by the gmail route because the path matches.
      // With the dispatcher, the proxy header `random.test` is recognized
      // as a foreign host and the request goes straight to Web Fetch.
      await h.fetch('/__fws/setup/fetch/fixture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://random.test/gmail/v1/users/me/profile',
          response: {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ custom: 'yes', source: 'fixture' }),
          },
        }),
      });

      const res = await h.fetch('/gmail/v1/users/me/profile', {
        headers: {
          'x-fws-original-host': 'random.test',
          'x-fws-original-scheme': 'https',
        },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.custom).toBe('yes');
      expect(data.source).toBe('fixture');
      // Crucially, NOT the seeded gmail profile (testuser@example.com)
      expect(data.emailAddress).toBeUndefined();
    });

    it('foreign host with no fixture for the path: hardcoded default fires (not the service route)', async () => {
      // Even when the path collides with a real service route, a foreign
      // host with no specific fixture for that path gets the Web Fetch
      // default response, NOT the service route's mock data.
      // (example.com is seeded with a host-only fixture, so any path on
      // example.com gets the default unless a more specific fixture exists.)
      const res = await h.fetch('/gmail/v1/users/me/profile', {
        headers: {
          'x-fws-original-host': 'totally.unrelated.test',
          'x-fws-original-scheme': 'https',
        },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.source).toBe('fws-web-fetch-default');
    });
  });
});
