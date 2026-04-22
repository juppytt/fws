import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateCACert, startMitmProxy } from '../src/proxy/mitm.js';
import { createApp } from '../src/server/app.js';
import { resetStore } from '../src/store/index.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import path from 'node:path';
import type { Server } from 'node:http';

/**
 * Repro harness for "fws mock proxy dies silently mid-run"
 * (adfi-openclaw #223 — observed as a zombie fws PID under the openclaw
 * gateway with `server.log` 0 bytes, every subsequent outbound HTTPS call
 * timing out because nothing answers on proxyPort=4101).
 *
 * Each `it()` block exercises one candidate abuse pattern against a fresh
 * MITM proxy instance. After the burst, the test asserts that:
 *   (a) no uncaughtException / unhandledRejection has fired, AND
 *   (b) the proxy still services a well-behaved CONNECT.
 *
 * Either side failing pinpoints a viable crash vector. The tests do NOT
 * auto-fix the bug — they simply surface which shape of client behaviour
 * kills the server, so we can land a targeted patch upstream.
 */

const caught: Error[] = [];
const onCaught = (err: Error): void => { caught.push(err); };
process.on('uncaughtException', onCaught);
process.on('unhandledRejection', onCaught as (e: unknown) => void);

async function newProxy(): Promise<{
  mockServer: Server;
  proxyServer: ReturnType<typeof startMitmProxy>;
  proxyPort: number;
  mockPort: number;
  caBundle: string;
  dataDir: string;
}> {
  resetStore();
  const dataDir = await mkdtemp(path.join(tmpdir(), 'fws-mitm-test-'));
  const { bundlePath } = await generateCACert(dataDir);
  const caBundle = await readFile(bundlePath, 'utf-8');
  const app = createApp();
  const mockServer: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const mockPort = (mockServer.address() as { port: number }).port;
  const proxyServer = startMitmProxy(mockPort, 0);
  const proxyPort = (proxyServer.address() as { port: number }).port;
  return { mockServer, proxyServer, proxyPort, mockPort, caBundle, dataDir };
}

async function killProxy(ctx: Awaited<ReturnType<typeof newProxy>>): Promise<void> {
  ctx.proxyServer.closeAllConnections?.();
  ctx.mockServer.closeAllConnections?.();
  ctx.proxyServer.close();
  ctx.mockServer.close();
  await rm(ctx.dataDir, { recursive: true, force: true });
}

/**
 * Warm the per-host TLS cert cache by doing one well-behaved CONNECT. Without
 * this, the very first CONNECT in the burst triggers openssl-based cert
 * signing, which is slow enough on CI runners that later tests' healthCheck
 * races it and times out. Warming makes the burst exercise the RST-during-
 * await window with an already-cached cert, which is the scenario we care
 * about anyway (the bug fires whenever the await's microtask boundary lets
 * a socket 'error' land without a listener).
 */
async function warmHost(port: number, host: string): Promise<void> {
  await healthCheck(port, host, 10_000);
}

/** Does the proxy still answer a well-behaved CONNECT? */
function healthCheck(port: number, host = 'gmail.googleapis.com', timeoutMs = 10_000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, timeoutMs);
    sock.on('connect', () => {
      sock.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`);
    });
    let buf = '';
    sock.on('data', (c) => {
      buf += c.toString('utf-8');
      if (buf.includes('200 Connection Established')) {
        clearTimeout(timer);
        sock.destroy();
        resolve(true);
      }
    });
    sock.on('error', () => { clearTimeout(timer); resolve(false); });
    sock.on('close', () => { clearTimeout(timer); resolve(buf.includes('200 Connection Established')); });
  });
}

describe('MITM proxy — abuse patterns', () => {
  beforeAll(() => { caught.length = 0; });
  afterAll(() => {
    process.off('uncaughtException', onCaught);
    process.off('unhandledRejection', onCaught as (e: unknown) => void);
  });

  // The health-check host is pre-warmed so the post-burst assertion doesn't
  // race fresh cert signing on slow CI runners. The burst deliberately uses
  // DIFFERENT intercepted hosts so the CONNECT handler's `await getHostCert`
  // still has a real cert-signing window to abort during.
  const HEALTH_HOST = 'gmail.googleapis.com';
  const BURST_HOST_A = 'www.googleapis.com';
  const BURST_HOST_B = 'api.github.com';

  it('A: CONNECT + immediate RST burst (fresh cert-signing host)', async () => {
    const ctx = await newProxy();
    await warmHost(ctx.proxyPort, HEALTH_HOST);
    await Promise.all(Array.from({ length: 30 }, () => new Promise<void>((resolve) => {
      const s = net.connect(ctx.proxyPort, '127.0.0.1');
      s.on('connect', () => {
        s.write(`CONNECT ${BURST_HOST_A}:443 HTTP/1.1\r\nHost: ${BURST_HOST_A}:443\r\n\r\n`);
        setTimeout(() => { s.resetAndDestroy(); resolve(); }, 2);
      });
      s.on('error', () => resolve());
      s.on('close', () => resolve());
    })));
    await new Promise((r) => setTimeout(r, 100));
    expect(caught, `A: ${caught.map((e) => e.message).join(' | ')}`).toEqual([]);
    expect(await healthCheck(ctx.proxyPort, HEALTH_HOST)).toBe(true);
    await killProxy(ctx);
  });

  it('B: CONNECT + RST against a second fresh intercepted host', async () => {
    const ctx = await newProxy();
    await warmHost(ctx.proxyPort, HEALTH_HOST);
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < 15; i++) {
      tasks.push(new Promise<void>((resolve) => {
        const s = net.connect(ctx.proxyPort, '127.0.0.1');
        s.on('connect', () => {
          s.write(`CONNECT ${BURST_HOST_B}:443 HTTP/1.1\r\nHost: ${BURST_HOST_B}:443\r\n\r\n`);
          setTimeout(() => { s.resetAndDestroy(); resolve(); }, i % 5);
        });
        s.on('error', () => resolve());
        s.on('close', () => resolve());
      }));
    }
    await Promise.all(tasks);
    await new Promise((r) => setTimeout(r, 100));
    expect(caught, `B: ${caught.map((e) => e.message).join(' | ')}`).toEqual([]);
    expect(await healthCheck(ctx.proxyPort, HEALTH_HOST)).toBe(true);
    await killProxy(ctx);
  });

  it('C: ClientHello then RST (abort during TLS handshake)', async () => {
    const ctx = await newProxy();
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < 25; i++) {
      tasks.push(new Promise<void>((resolve) => {
        const raw = net.connect(ctx.proxyPort, '127.0.0.1');
        raw.on('connect', () => {
          raw.write('CONNECT gmail.googleapis.com:443 HTTP/1.1\r\nHost: gmail.googleapis.com:443\r\n\r\n');
          raw.once('data', () => {
            // Got "200 Connection Established" → start TLS, then kill raw
            const tlsSock = tls.connect({ socket: raw, servername: 'gmail.googleapis.com', rejectUnauthorized: false });
            tlsSock.on('secureConnect', () => {
              raw.resetAndDestroy();
              resolve();
            });
            tlsSock.on('error', () => resolve());
            // Abort mid-handshake
            setTimeout(() => { raw.resetAndDestroy(); resolve(); }, 1);
          });
        });
        raw.on('error', () => resolve());
      }));
    }
    await Promise.all(tasks);
    await new Promise((r) => setTimeout(r, 200));
    expect(caught, `C: ${caught.map((e) => e.message).join(' | ')}`).toEqual([]);
    expect(await healthCheck(ctx.proxyPort)).toBe(true);
    await killProxy(ctx);
  });

  it('D: complete TLS, send partial HTTP request, then RST', async () => {
    const ctx = await newProxy();
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < 15; i++) {
      tasks.push(new Promise<void>((resolve) => {
        const raw = net.connect(ctx.proxyPort, '127.0.0.1');
        raw.on('connect', () => {
          raw.write('CONNECT gmail.googleapis.com:443 HTTP/1.1\r\nHost: gmail.googleapis.com:443\r\n\r\n');
          raw.once('data', () => {
            const tlsSock = tls.connect({
              socket: raw, servername: 'gmail.googleapis.com',
              ca: ctx.caBundle, rejectUnauthorized: false,
            });
            tlsSock.on('secureConnect', () => {
              // Send a partial HTTP request and then yank it
              tlsSock.write('GET /fwsversion/users/me/messages HTTP/1.1\r\nHost: gmail.googleapis.com\r\nContent-Length: 1000\r\n\r\n');
              setTimeout(() => { raw.resetAndDestroy(); resolve(); }, 2);
            });
            tlsSock.on('error', () => resolve());
          });
        });
        raw.on('error', () => resolve());
        raw.on('close', () => resolve());
      }));
    }
    await Promise.all(tasks);
    await new Promise((r) => setTimeout(r, 200));
    expect(caught, `D: ${caught.map((e) => e.message).join(' | ')}`).toEqual([]);
    expect(await healthCheck(ctx.proxyPort)).toBe(true);
    await killProxy(ctx);
  });

  it('E: realistic gh-like burst (HTTPS GET via proxy)', async () => {
    const ctx = await newProxy();
    // Do many real HTTPS GETs through the proxy to intercepted api.github.com.
    // Mixes handshake, request, response, and keep-alive teardown — the full
    // path the real gh/gws clients would take.
    const agent = new https.Agent({ keepAlive: false });
    const doGet = () => new Promise<void>((resolve) => {
      const req = https.request({
        host: 'api.github.com',
        port: 443,
        path: '/repos/testuser/my-project/issues',
        method: 'GET',
        agent,
        ca: ctx.caBundle,
        rejectUnauthorized: false,
        // Route through proxy manually by making HTTPS go through CONNECT:
        createConnection: (opts, oncreate) => {
          const raw = net.connect(ctx.proxyPort, '127.0.0.1');
          raw.once('connect', () => {
            raw.write(`CONNECT api.github.com:443 HTTP/1.1\r\nHost: api.github.com:443\r\n\r\n`);
            raw.once('data', () => {
              const s = tls.connect({
                socket: raw, servername: 'api.github.com',
                ca: ctx.caBundle, rejectUnauthorized: false,
              });
              oncreate!(null, s as unknown as import('node:net').Socket);
            });
          });
          raw.on('error', (e) => oncreate!(e, undefined as never));
          return undefined as unknown as import('node:net').Socket;
        },
      }, (res) => { res.on('data', () => {}); res.on('end', () => resolve()); res.on('error', () => resolve()); });
      req.on('error', () => resolve());
      req.end();
    });
    await Promise.all(Array.from({ length: 20 }, doGet));
    await new Promise((r) => setTimeout(r, 200));
    expect(caught, `E: ${caught.map((e) => e.message).join(' | ')}`).toEqual([]);
    expect(await healthCheck(ctx.proxyPort, 'api.github.com')).toBe(true);
    await killProxy(ctx);
  });
});
