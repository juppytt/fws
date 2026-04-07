import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const GOOGLEAPIS_HOSTS = [
  'gmail.googleapis.com',
  'www.googleapis.com',
  'tasks.googleapis.com',
  'workspaceevents.googleapis.com',
  'docs.googleapis.com',
  'slides.googleapis.com',
  'chat.googleapis.com',
  'classroom.googleapis.com',
  'forms.googleapis.com',
  'keep.googleapis.com',
  'meet.googleapis.com',
  'people.googleapis.com',
  'sheets.googleapis.com',
  'admin.googleapis.com',
];

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

export async function generateCACert(dataDir: string): Promise<{ caPath: string; keyPath: string }> {
  const certDir = path.join(dataDir, 'certs');
  await fs.mkdir(certDir, { recursive: true });

  const caPath = path.join(certDir, 'ca.crt');
  const keyPath = path.join(certDir, 'ca.key');

  // Check if CA already exists
  try {
    await fs.access(caPath);
    await fs.access(keyPath);
    caCert = {
      cert: await fs.readFile(caPath, 'utf-8'),
      key: await fs.readFile(keyPath, 'utf-8'),
    };
    return { caPath, keyPath };
  } catch {}

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

  return { caPath, keyPath };
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

export function startMitmProxy(mockPort: number, proxyPort: number): http.Server {
  const proxy = http.createServer((_req, res) => {
    res.writeHead(405);
    res.end('MITM proxy only supports CONNECT');
  });

  proxy.on('connect', async (req, clientSocket, head) => {
    const [hostname, portStr] = (req.url || '').split(':');
    const port = parseInt(portStr) || 443;

    // Only intercept googleapis.com hosts
    if (!GOOGLEAPIS_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h))) {
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

function handleInterceptedRequest(tlsSocket: tls.TLSSocket, hostname: string, mockPort: number): void {
  let buffer = Buffer.alloc(0);

  const onData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    // Check if we have a complete HTTP request header
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return; // wait for more data

    tlsSocket.removeListener('data', onData);

    const headerStr = buffer.subarray(0, headerEnd).toString('utf-8');
    const bodyStart = buffer.subarray(headerEnd + 4);

    const [requestLine, ...headerLines] = headerStr.split('\r\n');
    const [method, urlPath] = requestLine.split(' ');

    // Parse headers
    const headers: Record<string, string> = {};
    let contentLength = 0;
    for (const line of headerLines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const val = line.slice(colonIdx + 1).trim();
        headers[key] = val;
        if (key === 'content-length') contentLength = parseInt(val);
      }
    }

    // Collect body if present
    const collectBody = (bodyBuf: Buffer) => {
      // Forward to mock server
      const mockReq = http.request({
        hostname: 'localhost',
        port: mockPort,
        path: urlPath,
        method,
        headers: {
          ...headers,
          host: `localhost:${mockPort}`,
        },
      }, (mockRes) => {
        // Send response back through TLS socket
        let respHeader = `HTTP/1.1 ${mockRes.statusCode} ${mockRes.statusMessage}\r\n`;
        for (const [key, val] of Object.entries(mockRes.headers)) {
          if (val) {
            const vals = Array.isArray(val) ? val : [val];
            for (const v of vals) {
              respHeader += `${key}: ${v}\r\n`;
            }
          }
        }
        respHeader += '\r\n';

        tlsSocket.write(respHeader);
        mockRes.pipe(tlsSocket);
        mockRes.on('end', () => {
          tlsSocket.end();
        });
      });

      mockReq.on('error', () => {
        tlsSocket.write('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
        tlsSocket.end();
      });

      if (bodyBuf.length > 0) {
        mockReq.write(bodyBuf);
      }
      mockReq.end();
    };

    if (contentLength > 0 && bodyStart.length < contentLength) {
      // Need more body data
      const remaining: Buffer[] = [bodyStart];
      let received = bodyStart.length;
      tlsSocket.on('data', (chunk: Buffer) => {
        remaining.push(chunk);
        received += chunk.length;
        if (received >= contentLength) {
          collectBody(Buffer.concat(remaining));
        }
      });
    } else {
      collectBody(bodyStart);
    }
  };

  tlsSocket.on('data', onData);
  tlsSocket.on('error', () => {});
}
