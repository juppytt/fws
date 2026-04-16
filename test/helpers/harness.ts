import { createApp } from '../../src/server/app.js';
import { resetStore } from '../../src/store/index.js';
import { generateConfigDir } from '../../src/config/rewrite-cache.js';
import { generateCACert, startMitmProxy } from '../../src/proxy/mitm.js';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

export interface TestHarness {
  port: number;
  /** Direct HTTP fetch against mock server */
  fetch: (urlPath: string, init?: RequestInit) => Promise<Response>;
  /** Run gws command (uses discovery cache rewriting for regular commands) */
  gws: (args: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Run gws command with MITM proxy (for helper commands like +triage) */
  gwsProxy: (args: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Run gh command with MITM proxy */
  ghProxy: (args: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Run gh command with MITM proxy and GH_REPO set */
  ghProxyWithRepo: (args: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  cleanup: () => Promise<void>;
}

export async function createTestHarness(): Promise<TestHarness> {
  resetStore();

  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as any).port as number;

  const configDir = await mkdtemp(path.join(tmpdir(), 'fws-test-'));
  await generateConfigDir(port, configDir);

  // MITM proxy for helper commands
  const dataDir = await mkdtemp(path.join(tmpdir(), 'fws-test-data-'));
  const { bundlePath } = await generateCACert(dataDir);
  const proxyServer = startMitmProxy(port, 0); // random port
  const proxyPort = (proxyServer.address() as any).port as number;

  const baseEnv = {
    ...process.env,
    GOOGLE_WORKSPACE_CLI_CONFIG_DIR: configDir,
    GOOGLE_WORKSPACE_CLI_TOKEN: 'fake',
  };

  const proxyEnv = {
    ...baseEnv,
    HTTPS_PROXY: `http://localhost:${proxyPort}`,
    SSL_CERT_FILE: bundlePath,
  };

  const gwsPath = process.env.GWS_PATH || 'gws';

  function parseArgs(args: string): string[] {
    // Split on whitespace but keep JSON objects and quoted strings as single args
    const result: string[] = [];
    let current = '';
    let braceDepth = 0;
    let inQuote: string | null = null;
    for (const char of args) {
      if (!inQuote && !braceDepth && (char === '"' || char === "'")) {
        inQuote = char;
        continue;
      }
      if (inQuote && char === inQuote) {
        inQuote = null;
        continue;
      }
      if (!inQuote) {
        if (char === '{') braceDepth++;
        if (char === '}') braceDepth--;
      }
      if (char === ' ' && braceDepth === 0 && !inQuote) {
        if (current) result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    if (current) result.push(current);
    return result;
  }

  function runCmd(bin: string, args: string, env: Record<string, string | undefined>): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      execFile(bin, parseArgs(args), { env, timeout: 10000 }, (err, stdout, stderr) => {
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: err ? (err as any).code ?? 1 : 0,
        });
      });
    });
  }

  const ghEnv = {
    ...proxyEnv,
    GH_TOKEN: 'fake',
  };

  const ghEnvWithRepo = {
    ...ghEnv,
    GH_REPO: 'testuser/my-project',
  };

  const ghPath = process.env.GH_PATH || 'gh';

  return {
    port,
    fetch: (urlPath: string, init?: RequestInit) =>
      globalThis.fetch(`http://localhost:${port}${urlPath}`, init),
    gws: (args: string) => runCmd(gwsPath, args, baseEnv),
    gwsProxy: (args: string) => runCmd(gwsPath, args, proxyEnv),
    ghProxy: (args: string) => runCmd(ghPath, args, ghEnv),
    ghProxyWithRepo: (args: string) => runCmd(ghPath, args, ghEnvWithRepo),
    cleanup: async () => {
      server.close();
      proxyServer.close();
      await rm(configDir, { recursive: true, force: true });
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
