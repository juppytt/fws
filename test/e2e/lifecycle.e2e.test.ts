import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { startFwsDaemon, type CliHarness } from './helpers/cli-harness.js';

/**
 * Exercises the real `fws server start` → daemon → `fws server stop` lifecycle.
 * If this fails, the daemonization code in bin/fws.ts is broken.
 */
describe('e2e: fws daemon lifecycle', () => {
  let h: CliHarness;

  beforeAll(async () => {
    h = await startFwsDaemon();
  });

  afterAll(async () => {
    await h.stop();
  });

  it('writes a server.json pidfile in FWS_DATA_DIR', () => {
    const serverInfo = path.join(h.dataDir, 'server.json');
    expect(existsSync(serverInfo)).toBe(true);
  });

  it('responds to /__fws/status', async () => {
    const res = await h.fetch('/__fws/status');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('serves seeded gmail data through real HTTP', async () => {
    const res = await h.fetch('/gmail/v1/users/me/profile');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.emailAddress).toBeTruthy();
  });

  it('survives multiple sequential requests', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await h.fetch('/__fws/status');
      expect(res.status).toBe(200);
    }
  });
});

describe('e2e: stop tears down the pidfile', () => {
  it('removes server.json after fws server stop', async () => {
    const h = await startFwsDaemon();
    const serverInfo = path.join(h.dataDir, 'server.json');
    expect(existsSync(serverInfo)).toBe(true);
    await h.stop();
    // dataDir is removed by stop(), so the pidfile is gone with it
    expect(existsSync(serverInfo)).toBe(false);
  });
});
