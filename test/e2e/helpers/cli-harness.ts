/**
 * E2E harness that drives the real `fws` CLI binary.
 *
 * Unlike test/helpers/harness.ts (which spins up the Express app in-process),
 * this harness exercises the full daemon lifecycle:
 *
 *   fws server start  →  reach /__fws/status via real HTTP  →  fws server stop
 *
 * Each harness uses an isolated FWS_DATA_DIR (tmp) and a free port, so multiple
 * e2e tests can run in parallel without colliding on server.json or 4100.
 */
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FWS_BIN = path.join(REPO_ROOT, 'bin', 'fws-cli.js');

export interface CliHarness {
  port: number;
  proxyPort: number;
  caPath: string;
  configDir: string;
  dataDir: string;
  /** Env vars for child processes that should hit the mock via the proxy */
  proxyEnv: Record<string, string>;
  /** Run an arbitrary command with proxyEnv applied */
  run: (
    bin: string,
    args: string[],
    extraEnv?: Record<string, string>,
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Direct fetch against the mock server (no proxy) */
  fetch: (urlPath: string, init?: RequestInit) => Promise<Response>;
  /** Stop the daemon and clean up tmp dirs */
  stop: () => Promise<void>;
}

export interface StartOptions {
  /** Override the binary location (defaults to repo bin/fws-cli.js) */
  fwsBin?: string;
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error('failed to get free port'));
      }
    });
  });
}

function runCmd(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 15000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(bin, args, { env, timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
        exitCode: err ? ((err as NodeJS.ErrnoException).code as unknown as number) ?? 1 : 0,
      });
    });
  });
}

async function waitForHealth(port: number, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/__fws/status`);
      if (res.ok) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(
    `fws daemon did not become healthy on port ${port} within ${timeoutMs}ms: ${String(lastErr)}`,
  );
}

/**
 * Start a fresh fws daemon in an isolated FWS_DATA_DIR.
 *
 * The daemon is started via the real CLI (`fws server start`), which spawns
 * a detached background process. We then read server.json to discover the
 * proxy port and CA path it picked.
 */
export async function startFwsDaemon(opts: StartOptions = {}): Promise<CliHarness> {
  const fwsBin = opts.fwsBin ?? FWS_BIN;
  const port = await getFreePort();
  const dataDir = await mkdtemp(path.join(tmpdir(), 'fws-e2e-data-'));
  const configDir = path.join(dataDir, 'config');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FWS_DATA_DIR: dataDir,
  };

  const startResult = await runCmd(
    'node',
    [fwsBin, 'server', 'start', '-p', String(port)],
    env,
    20000,
  );

  if (startResult.exitCode !== 0 || /Failed to start/i.test(startResult.stdout + startResult.stderr)) {
    await rm(dataDir, { recursive: true, force: true });
    throw new Error(
      `fws server start failed (exit ${startResult.exitCode}):\n` +
        `stdout: ${startResult.stdout}\nstderr: ${startResult.stderr}`,
    );
  }

  await waitForHealth(port);

  // Read server.json to discover proxyPort and caPath
  const serverInfoPath = path.join(dataDir, 'server.json');
  const info = JSON.parse(await readFile(serverInfoPath, 'utf-8')) as {
    port: number;
    proxyPort: number;
    pid: number;
    caPath: string;
  };

  const proxyEnv: Record<string, string> = {
    FWS_DATA_DIR: dataDir,
    GOOGLE_WORKSPACE_CLI_CONFIG_DIR: configDir,
    GOOGLE_WORKSPACE_CLI_TOKEN: 'fake',
    HTTPS_PROXY: `http://localhost:${info.proxyPort}`,
    SSL_CERT_FILE: info.caPath,
    GH_TOKEN: 'fake',
    GH_REPO: 'testuser/my-project',
  };

  return {
    port: info.port,
    proxyPort: info.proxyPort,
    caPath: info.caPath,
    configDir,
    dataDir,
    proxyEnv,
    fetch: (urlPath, init) => globalThis.fetch(`http://localhost:${info.port}${urlPath}`, init),
    run: (bin, args, extraEnv = {}) =>
      runCmd(bin, args, { ...process.env, ...proxyEnv, ...extraEnv }),
    stop: async () => {
      // Use the real CLI so we exercise the stop path too
      await runCmd('node', [fwsBin, 'server', 'stop'], env, 5000);
      // Verify pidfile is gone (best-effort)
      try {
        await access(serverInfoPath);
        // Still there → force-kill the pid
        try {
          process.kill(info.pid, 'SIGKILL');
        } catch {}
      } catch {
        // pidfile gone, expected
      }
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
