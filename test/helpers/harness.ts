import { createApp } from '../../src/server/app.js';
import { resetStore } from '../../src/store/index.js';
import { generateConfigDir } from '../../src/config/rewrite-cache.js';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

export interface TestHarness {
  port: number;
  /** Direct HTTP fetch against mock server */
  fetch: (urlPath: string, init?: RequestInit) => Promise<Response>;
  /** Run gws command and return parsed result */
  gws: (args: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
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

  const env = {
    ...process.env,
    GOOGLE_WORKSPACE_CLI_CONFIG_DIR: configDir,
    GOOGLE_WORKSPACE_CLI_TOKEN: 'fake',
  };

  const gwsPath = process.env.GWS_PATH || 'gws';

  return {
    port,
    fetch: (urlPath: string, init?: RequestInit) =>
      globalThis.fetch(`http://localhost:${port}${urlPath}`, init),
    gws: (args: string) =>
      new Promise((resolve) => {
        execFile(gwsPath, args.split(/\s+/), { env, timeout: 10000 }, (err, stdout, stderr) => {
          resolve({
            stdout: stdout || '',
            stderr: stderr || '',
            exitCode: err ? (err as any).code ?? 1 : 0,
          });
        });
      }),
    cleanup: async () => {
      server.close();
      await rm(configDir, { recursive: true, force: true });
    },
  };
}
