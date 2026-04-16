import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { hasFixtureForHost } from '../server/routes/fetch.js';
import { isAllowlistedHost } from './intercepted-hosts.js';

interface CertPair {
  key: string;
  cert: string;
}

let caCert: CertPair | null = null;
const hostCerts = new Map<string, CertPair>();

function generateCA(): CertPair {
  // Generate CA key pair
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  // Self-signed CA certificate using Node's built-in X509Certificate isn't enough,
  // we need to use the openssl-like approach with forge or raw ASN.1.
  // Instead, use a simpler approach: generate with command-line openssl at startup time.
  // For now, return placeholders - the actual generation happens in generateCACert().
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    cert: '', // filled by generateCACert
  };
}

// Well-known system CA bundle locations (checked in order).
const SYSTEM_CA_PATHS = [
  '/etc/ssl/certs/ca-certificates.crt',   // Debian/Ubuntu/Arch
  '/etc/pki/tls/certs/ca-bundle.crt',     // RHEL/Fedora
  '/etc/ssl/cert.pem',                     // Alpine/macOS
];

async function findSystemCABundle(): Promise<string | null> {
  for (const p of SYSTEM_CA_PATHS) {
    try { await fs.access(p); return p; } catch {}
  }
  return null;
}

export async function generateCACert(dataDir: string): Promise<{ caPath: string; keyPath: string; bundlePath: string }> {
  const certDir = path.join(dataDir, 'certs');
  await fs.mkdir(certDir, { recursive: true });

  const caPath = path.join(certDir, 'ca.crt');
  const keyPath = path.join(certDir, 'ca.key');
  const bundlePath = path.join(certDir, 'ca-bundle.crt');

  // Check if CA already exists
  try {
    await fs.access(caPath);
    await fs.access(keyPath);
    caCert = {
      cert: await fs.readFile(caPath, 'utf-8'),
      key: await fs.readFile(keyPath, 'utf-8'),
    };
  } catch {
    // Generate new CA using openssl
    const { execFileSync } = await import('node:child_process');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', keyPath, '-out', caPath,
      '-days', '3650', '-nodes',
      '-subj', '/CN=fws-mock-ca',
    ], { stdio: 'pipe' });

    caCert = {
      cert: await fs.readFile(caPath, 'utf-8'),
      key: await fs.readFile(keyPath, 'utf-8'),
    };
  }

  // Build a combined bundle: FWS CA + system CAs, so that passthrough
  // hosts (real internet) can be verified alongside MITM-intercepted ones.
  const systemCA = await findSystemCABundle();
  const parts = [caCert.cert.trimEnd()];
  if (systemCA) {
    parts.push(await fs.readFile(systemCA, 'utf-8'));
  }
  await fs.writeFile(bundlePath, parts.join('\n'));

  return { caPath, keyPath, bundlePath };
}

async function getHostCert(hostname: string): Promise<CertPair> {
  const cached = hostCerts.get(hostname);
  if (cached) return cached;

  if (!caCert) throw new Error('CA not initialized');

  const { execFileSync } = await import('node:child_process');

  // Generate host key
  const hostKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyPem = hostKey.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

  // Generate CSR and sign with CA
  const tmpDir = `/tmp/fws-cert-${Date.now()}`;
  await fs.mkdir(tmpDir, { recursive: true });

  const keyFile = path.join(tmpDir, 'host.key');
  const csrFile = path.join(tmpDir, 'host.csr');
  const certFile = path.join(tmpDir, 'host.crt');
  const extFile = path.join(tmpDir, 'ext.cnf');

  await fs.writeFile(keyFile, keyPem);
  await fs.writeFile(extFile, `subjectAltName=DNS:${hostname}\n`);

  // Create CSR
  execFileSync('openssl', [
    'req', '-new', '-key', keyFile, '-out', csrFile,
    '-subj', `/CN=${hostname}`,
  ], { stdio: 'pipe' });

  // Find CA cert/key paths
  const caCertPath = Object.keys(caCert).length ? undefined : undefined;

  // Write CA cert/key to temp files for signing
  const tmpCaCert = path.join(tmpDir, 'ca.crt');
  const tmpCaKey = path.join(tmpDir, 'ca.key');
  await fs.writeFile(tmpCaCert, caCert.cert);
  await fs.writeFile(tmpCaKey, caCert.key);

  // Sign with CA
  execFileSync('openssl', [
    'x509', '-req', '-in', csrFile,
    '-CA', tmpCaCert, '-CAkey', tmpCaKey,
    '-CAcreateserial', '-out', certFile,
    '-days', '365', '-extfile', extFile,
  ], { stdio: 'pipe' });

  const certPem = await fs.readFile(certFile, 'utf-8');

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true });

  const pair = { key: keyPem, cert: certPem };
  hostCerts.set(hostname, pair);
  return pair;
}

/**
 * Decide whether to intercept a host instead of passing it through to the
 * real internet. Two reasons to intercept:
 *  1. The host is in the built-in service allowlist (gmail.googleapis.com,
 *     api.github.com, ...).
 *  2. There is at least one Web Fetch fixture covering this host. Adding a
 *     fixture for `https://example.com/foo` automatically makes example.com
 *     eligible for interception, so users don't have to flip a global flag.
 *
 * The Web Fetch store is read on each CONNECT, so adding a fixture at
 * runtime takes effect for new connections immediately.
 */
function shouldInterceptHost(hostname: string): boolean {
  if (isAllowlistedHost(hostname)) return true;
  return hasFixtureForHost(hostname);
}

export function startMitmProxy(mockPort: number, proxyPort: number): http.Server {
  // Plain HTTP requests (when the client uses HTTP_PROXY for an http:// URL)
  // arrive here as ordinary requests with an absolute URL in the request line.
  // Forward them to the mock server with X-Fws-Original-Host so the catch-all
  // route can route them, OR pass them through to the real internet when the
  // host is not intercepted.
  const proxy = http.createServer((req, res) => {
    handlePlainHttp(req, res, mockPort);
  });

  proxy.on('connect', async (req, clientSocket, head) => {
    const [hostname, portStr] = (req.url || '').split(':');
    const port = parseInt(portStr) || 443;

    if (!shouldInterceptHost(hostname)) {
      // Pass through to real server
      const serverSocket = net.connect(port, hostname, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        serverSocket.write(head);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
      });
      serverSocket.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => serverSocket.destroy());
      return;
    }

    // Intercept: terminate TLS and forward to mock server
    try {
      const hostCert = await getHostCert(hostname);

      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

      const tlsSocket = new tls.TLSSocket(clientSocket, {
        isServer: true,
        key: hostCert.key,
        cert: hostCert.cert + caCert!.cert, // chain
      });

      if (head.length > 0) {
        tlsSocket.unshift(head);
      }

      // Read the HTTP request from the TLS socket
      handleInterceptedRequest(tlsSocket, hostname, mockPort);
    } catch (err) {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.destroy();
    }
  });

  proxy.listen(proxyPort);
  return proxy;
}

/**
 * Handle a plain (non-CONNECT) HTTP request received by the proxy. This is
 * the path curl/wget take when given `HTTP_PROXY` for an `http://` URL: the
 * client sends `GET http://example.com/foo HTTP/1.1` directly to the proxy
 * (note: absolute URL in request line, per HTTP/1.1 §5.3.2).
 *
 * If the host is in the intercept set, forward to the mock server with
 * `X-Fws-Original-Host` so the catch-all route can find a fixture. Otherwise
 * pass the request through to the real internet (mirrors the CONNECT
 * passthrough for HTTPS).
 */
function handlePlainHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  mockPort: number,
): void {
  const reqUrl = req.url || '';
  let parsed: URL;
  try {
    parsed = new URL(reqUrl);
  } catch {
    res.writeHead(400);
    res.end('Bad Request: expected absolute URL in request line');
    return;
  }

  const hostname = parsed.hostname;

  if (!shouldInterceptHost(hostname)) {
    // Passthrough: open a TCP connection and forward the request unchanged.
    const upstream = http.request(
      {
        hostname,
        port: parsed.port ? parseInt(parsed.port) : 80,
        method: req.method,
        path: parsed.pathname + parsed.search,
        headers: req.headers,
      },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end('Bad Gateway');
    });
    req.pipe(upstream);
    return;
  }

  // Intercepted: forward to local mock server with markers identifying the
  // original host and scheme so the Web Fetch catch-all can build the
  // canonical URL for fixture lookup.
  const mockReq = http.request(
    {
      hostname: 'localhost',
      port: mockPort,
      method: req.method,
      path: parsed.pathname + parsed.search,
      headers: {
        ...req.headers,
        host: `localhost:${mockPort}`,
        'x-fws-original-host': hostname,
        'x-fws-original-scheme': 'http',
      },
    },
    (mockRes) => {
      res.writeHead(mockRes.statusCode ?? 502, mockRes.headers);
      mockRes.pipe(res);
    },
  );
  mockReq.on('error', () => {
    res.writeHead(502);
    res.end('Bad Gateway');
  });
  req.pipe(mockReq);
}

function handleInterceptedRequest(tlsSocket: tls.TLSSocket, hostname: string, mockPort: number): void {
  // One TLS socket can carry many HTTP/1.1 requests via keep-alive. The
  // previous implementation handled exactly one request and then called
  // tlsSocket.end(), which broke any client (gh, gws) that pipelined or
  // reused the connection — the second request raced against the close
  // and surfaced as `Post ...: EOF`. This rewrite keeps the socket open
  // and processes requests in a loop until the client / upstream signals
  // Connection: close.

  let buffer = Buffer.alloc(0);
  let processing = false;
  let closed = false;

  const closeSocket = () => {
    if (closed) return;
    closed = true;
    try {
      tlsSocket.end();
    } catch {}
  };

  const writeAndClose = (resp: string) => {
    if (closed) return;
    try {
      tlsSocket.write(resp);
    } catch {}
    closeSocket();
  };

  const tryProcessNext = () => {
    if (processing || closed) return;

    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return; // wait for more data

    const headerStr = buffer.subarray(0, headerEnd).toString('utf-8');
    const [requestLine, ...headerLines] = headerStr.split('\r\n');
    const [method, urlPath] = requestLine.split(' ');

    const headers: Record<string, string> = {};
    let contentLength = 0;
    let clientWantsClose = false;
    for (const line of headerLines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const val = line.slice(colonIdx + 1).trim();
        headers[key] = val;
        if (key === 'content-length') contentLength = parseInt(val) || 0;
        else if (key === 'connection' && val.toLowerCase() === 'close') clientWantsClose = true;
      }
    }

    // Wait for the full body before forwarding. NOTE: this proxy does not
    // support Transfer-Encoding: chunked on the *request* side. gh and gws
    // both buffer requests and send a Content-Length, so this is fine in
    // practice. If a future client uses chunked we'll need to add it.
    const bodyAvailable = buffer.length - (headerEnd + 4);
    if (bodyAvailable < contentLength) return; // wait for more body data

    const bodyBuf = buffer.subarray(headerEnd + 4, headerEnd + 4 + contentLength);
    // Trim the consumed bytes off the buffer; anything left is part of the
    // next pipelined request.
    buffer = buffer.subarray(headerEnd + 4 + contentLength);

    processing = true;
    forwardRequest(method, urlPath, headers, bodyBuf, clientWantsClose);
  };

  const forwardRequest = (
    method: string,
    urlPath: string,
    headers: Record<string, string>,
    bodyBuf: Buffer,
    clientWantsClose: boolean,
  ) => {
    const mockReq = http.request(
      {
        hostname: 'localhost',
        port: mockPort,
        path: urlPath,
        method,
        headers: {
          ...headers,
          host: `localhost:${mockPort}`,
          // Markers for the Web Fetch catch-all so it can build the
          // canonical URL for fixture lookup.
          'x-fws-original-host': hostname,
          'x-fws-original-scheme': 'https',
        },
      },
      (mockRes) => {
        // Buffer the upstream response so we can write it as a single
        // chunk and decide whether to close the TLS socket afterwards.
        // For mock-server traffic the responses are small, so buffering
        // is acceptable.
        const chunks: Buffer[] = [];
        mockRes.on('data', (c: Buffer) => chunks.push(c));
        mockRes.on('end', () => {
          if (closed) return;

          const body = Buffer.concat(chunks);
          let respHeader = `HTTP/1.1 ${mockRes.statusCode ?? 502} ${mockRes.statusMessage ?? ''}\r\n`;
          let upstreamWantsClose = false;
          for (const [key, val] of Object.entries(mockRes.headers)) {
            if (val == null) continue;
            const vals = Array.isArray(val) ? val : [val];
            for (const v of vals) {
              respHeader += `${key}: ${v}\r\n`;
              if (key.toLowerCase() === 'connection' && String(v).toLowerCase() === 'close') {
                upstreamWantsClose = true;
              }
            }
          }
          respHeader += '\r\n';

          try {
            tlsSocket.write(respHeader);
            if (body.length > 0) tlsSocket.write(body);
          } catch {
            closeSocket();
            return;
          }

          processing = false;

          if (clientWantsClose || upstreamWantsClose) {
            closeSocket();
          } else {
            // Defer so any newly-arrived bytes get flushed onto `buffer`
            // before we look at it again.
            setImmediate(tryProcessNext);
          }
        });
        mockRes.on('error', () => {
          processing = false;
          writeAndClose('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        });
      },
    );

    mockReq.on('error', () => {
      processing = false;
      writeAndClose('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    });

    if (bodyBuf.length > 0) mockReq.write(bodyBuf);
    mockReq.end();
  };

  tlsSocket.on('data', (chunk: Buffer) => {
    if (closed) return;
    buffer = Buffer.concat([buffer, chunk]);
    tryProcessNext();
  });

  tlsSocket.on('end', () => closeSocket());
  tlsSocket.on('close', () => {
    closed = true;
  });
  tlsSocket.on('error', () => closeSocket());
}
