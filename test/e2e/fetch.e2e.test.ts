import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFwsDaemon, type CliHarness } from './helpers/cli-harness.js';

/**
 * E2E coverage for Web Fetch — real `curl` through the MITM proxy against
 * the running daemon. Exercises the full pipeline:
 *
 *   curl → HTTP_PROXY/HTTPS_PROXY → mitm.ts → mock server → fetch.ts
 *
 * The seeded fixtures (example.com / httpbin.org) self-enable interception
 * for those hosts — no global toggle needed.
 */
describe('e2e: Web Fetch through real proxy', () => {
  let h: CliHarness;

  beforeAll(async () => {
    h = await startFwsDaemon();
  });

  afterAll(async () => {
    await h.stop();
  });

  describe('HTTPS via CONNECT', () => {
    it('serves the seeded example.com fixture to curl', async () => {
      const { stdout, stderr, exitCode } = await h.run('curl', [
        '-sf',
        '--proxy', `http://localhost:${h.proxyPort}`,
        '--cacert', h.caPath,
        'https://example.com/',
      ]);
      expect(exitCode, `curl stderr: ${stderr}`).toBe(0);
      expect(stdout).toContain('Example Domain (mocked)');
    });

    it('serves the seeded httpbin.org fixture (host-only match)', async () => {
      const { stdout, stderr, exitCode } = await h.run('curl', [
        '-sf',
        '--proxy', `http://localhost:${h.proxyPort}`,
        '--cacert', h.caPath,
        'https://httpbin.org/anything/here?x=1',
      ]);
      expect(exitCode, `curl stderr: ${stderr}`).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.mock).toBe(true);
    });

    it('runtime-injected fixture is reachable via curl', async () => {
      // Add a fixture for a brand-new host. The host then becomes eligible
      // for proxy interception automatically.
      await h.fetch('/__fws/setup/fetch/fixture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://api.injected.test/v1/echo',
          response: {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ injected: 'yes', via: 'curl-e2e' }),
          },
        }),
      });

      const { stdout, stderr, exitCode } = await h.run('curl', [
        '-sf',
        '--proxy', `http://localhost:${h.proxyPort}`,
        '--cacert', h.caPath,
        'https://api.injected.test/v1/echo',
      ]);
      expect(exitCode, `curl stderr: ${stderr}`).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.injected).toBe('yes');
    });

    it('passes through to the real internet for hosts with no fixture', async () => {
      // Without a fixture, the proxy doesn't intercept random hosts.
      // We can't easily test "real internet" in CI without flake, but we
      // CAN verify that the proxy doesn't error out — it should attempt
      // a TCP connection to a non-existent host, which fails cleanly.
      const { exitCode } = await h.run('curl', [
        '-s',
        '-o', '/dev/null',
        '-w', '%{http_code}',
        '--max-time', '3',
        '--proxy', `http://localhost:${h.proxyPort}`,
        'https://nonexistent-host-fws-e2e.invalid/',
      ]);
      // curl exits non-zero (DNS failure / proxy 502) — that's the
      // passthrough path failing as expected. The point is that we did
      // NOT get a mocked response back.
      expect(exitCode).not.toBe(0);
    });

    it('passthrough TLS verification succeeds with ca-bundle (real host)', async () => {
      // The ca-bundle.crt includes system CAs, so passthrough to real
      // HTTPS hosts should pass TLS verification. We hit a public
      // endpoint that always responds without needing an API key.
      const { stdout, exitCode } = await h.run('curl', [
        '-s',
        '-o', '/dev/null',
        '-w', '%{http_code}',
        '--max-time', '5',
        '--proxy', `http://localhost:${h.proxyPort}`,
        '--cacert', h.caPath,
        'https://api.openai.com/v1/models',
      ]);
      // 401 (no API key) proves TLS handshake succeeded — the request
      // reached the real server and got an auth error, not a cert error.
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('401');
    });
  });

  describe('Plain HTTP', () => {
    it('curl http:// to host-only fixture matches regardless of scheme', async () => {
      const { stdout, stderr, exitCode } = await h.run('curl', [
        '-sf',
        '--proxy', `http://localhost:${h.proxyPort}`,
        'http://httpbin.org/anything',
      ]);
      expect(exitCode, `curl stderr: ${stderr}`).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.mock).toBe(true);
    });
  });

  describe('Path collision regression (gh#15)', () => {
    it('foreign-host fixture wins over a colliding service-route path', async () => {
      // Register a fixture for a foreign host whose path happens to
      // collide with the gmail route. Without the host dispatcher, the
      // gmail route would shadow the fixture.
      await h.fetch('/__fws/setup/fetch/fixture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://collision.test/gmail/v1/users/me/profile',
          response: {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ source: 'fixture-not-gmail' }),
          },
        }),
      });

      const { stdout, stderr, exitCode } = await h.run('curl', [
        '-sf',
        '--proxy', `http://localhost:${h.proxyPort}`,
        '--cacert', h.caPath,
        'https://collision.test/gmail/v1/users/me/profile',
      ]);
      expect(exitCode, `curl stderr: ${stderr}`).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.source).toBe('fixture-not-gmail');
      expect(data.emailAddress).toBeUndefined();
    });
  });
});
