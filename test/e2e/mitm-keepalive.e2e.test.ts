import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';
import { startFwsDaemon, type CliHarness } from './helpers/cli-harness.js';

/**
 * Regression test for #7: the MITM proxy used to close the TLS socket after
 * one response, breaking HTTP/1.1 keep-alive. Real CLIs (gh, gws) reuse
 * connections and intermittently failed with `EOF` on the second request.
 *
 * This test pins the contract directly: open ONE CONNECT tunnel to the proxy,
 * upgrade to TLS, send TWO HTTP requests over the same socket, assert both
 * responses come back intact.
 */
describe('e2e: MITM proxy keep-alive (regression test for #7)', () => {
  let h: CliHarness;
  let caCert: string;

  beforeAll(async () => {
    h = await startFwsDaemon();
    caCert = readFileSync(h.caPath, 'utf-8');
  });

  afterAll(async () => {
    await h.stop();
  });

  it('handles two sequential requests on the same TLS connection', async () => {
    const responses = await sendTwoRequestsOverOneTlsSocket(h.proxyPort, caCert, [
      { method: 'GET', path: '/user' },
      { method: 'GET', path: '/repos/testuser/my-project' },
    ]);

    expect(responses).toHaveLength(2);

    expect(responses[0].statusCode).toBe(200);
    const user = JSON.parse(responses[0].body);
    expect(user.login).toBe('testuser');

    expect(responses[1].statusCode).toBe(200);
    const repo = JSON.parse(responses[1].body);
    expect(repo.full_name).toBe('testuser/my-project');
  });

  it('handles three sequential requests on the same TLS connection', async () => {
    const responses = await sendTwoRequestsOverOneTlsSocket(h.proxyPort, caCert, [
      { method: 'GET', path: '/user' },
      { method: 'GET', path: '/repos/testuser/my-project/issues' },
      { method: 'GET', path: '/repos/testuser/my-project/pulls' },
    ]);

    expect(responses).toHaveLength(3);
    for (const r of responses) {
      expect(r.statusCode).toBe(200);
    }
    const issues = JSON.parse(responses[1].body);
    const pulls = JSON.parse(responses[2].body);
    expect(Array.isArray(issues)).toBe(true);
    expect(Array.isArray(pulls)).toBe(true);
  });
});

interface ParsedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

interface RequestSpec {
  method: string;
  path: string;
  body?: string;
}

/**
 * Open one CONNECT tunnel to the MITM proxy, upgrade to TLS against
 * api.github.com (which the proxy intercepts), then send each request on the
 * SAME TLS socket and parse the responses in order.
 *
 * Deliberately does NOT use Node's `https.Agent` — we want to drive the wire
 * protocol directly so the test fails immediately if the proxy closes the
 * socket prematurely.
 */
async function sendTwoRequestsOverOneTlsSocket(
  proxyPort: number,
  caCert: string,
  requests: RequestSpec[],
): Promise<ParsedResponse[]> {
  // Step 1: open the CONNECT tunnel
  const tunnel = await new Promise<net.Socket>((resolve, reject) => {
    const sock = net.connect(proxyPort, '127.0.0.1');
    let buf = '';
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf-8');
      const end = buf.indexOf('\r\n\r\n');
      if (end === -1) return;
      sock.removeListener('data', onData);
      const statusLine = buf.split('\r\n')[0];
      if (!/^HTTP\/1\.\d 200/.test(statusLine)) {
        sock.destroy();
        reject(new Error(`CONNECT failed: ${statusLine}`));
        return;
      }
      resolve(sock);
    };
    sock.on('data', onData);
    sock.on('error', reject);
    sock.write('CONNECT api.github.com:443 HTTP/1.1\r\nHost: api.github.com:443\r\n\r\n');
  });

  // Step 2: TLS handshake on the tunneled socket
  const tlsSock = await new Promise<tls.TLSSocket>((resolve, reject) => {
    const t = tls.connect({
      socket: tunnel,
      servername: 'api.github.com',
      ca: caCert,
    });
    t.once('secureConnect', () => resolve(t));
    t.once('error', reject);
  });

  // Step 3: send each request and parse the response, all on the same socket.
  // We do this serially so we can identify which response belongs to which
  // request without dealing with HTTP pipelining ambiguity.
  const out: ParsedResponse[] = [];
  for (const req of requests) {
    const reqLines = [
      `${req.method} ${req.path} HTTP/1.1`,
      `Host: api.github.com`,
      `User-Agent: fws-keepalive-test`,
      `Accept: application/json`,
    ];
    if (req.body !== undefined) {
      reqLines.push(`Content-Length: ${Buffer.byteLength(req.body)}`);
      reqLines.push(`Content-Type: application/json`);
    }
    reqLines.push(''); // header terminator
    reqLines.push(req.body ?? '');
    tlsSock.write(reqLines.join('\r\n'));

    const resp = await readOneResponse(tlsSock);
    out.push(resp);
  }

  tlsSock.end();
  return out;
}

/** Read exactly one HTTP/1.1 response off a TLS socket. Honors Content-Length. */
function readOneResponse(sock: tls.TLSSocket): Promise<ParsedResponse> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let headerLen = -1;
    let contentLength = -1;
    let headers: Record<string, string> = {};
    let statusCode = 0;

    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (headerLen === -1) {
        const end = buf.indexOf('\r\n\r\n');
        if (end === -1) return; // need more
        headerLen = end + 4;
        const headerStr = buf.subarray(0, end).toString('utf-8');
        const [statusLine, ...lines] = headerStr.split('\r\n');
        const m = statusLine.match(/^HTTP\/1\.\d (\d+)/);
        if (!m) {
          cleanup();
          reject(new Error(`bad status line: ${statusLine}`));
          return;
        }
        statusCode = parseInt(m[1]);
        for (const line of lines) {
          const idx = line.indexOf(':');
          if (idx > 0) {
            const k = line.slice(0, idx).trim().toLowerCase();
            const v = line.slice(idx + 1).trim();
            headers[k] = v;
            if (k === 'content-length') contentLength = parseInt(v);
          }
        }
        if (contentLength === -1) {
          // No Content-Length: the mock always sets one (express does), so
          // treat this as an error rather than reading until close.
          cleanup();
          reject(new Error('response missing Content-Length'));
          return;
        }
      }
      if (buf.length - headerLen >= contentLength) {
        const body = buf.subarray(headerLen, headerLen + contentLength).toString('utf-8');
        cleanup();
        resolve({ statusCode, headers, body });
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      sock.removeListener('data', onData);
      sock.removeListener('error', onError);
    };
    sock.on('data', onData);
    sock.on('error', onError);
  });
}
