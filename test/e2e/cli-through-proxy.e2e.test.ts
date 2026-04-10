import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFwsDaemon, type CliHarness } from './helpers/cli-harness.js';

/**
 * End-to-end: real CLI tools (`gh`, `curl`) talk to the daemon through the
 * MITM proxy, exactly as a user would after running `eval $(fws server env)`.
 */
describe('e2e: CLI tools through MITM proxy', () => {
  let h: CliHarness;

  beforeAll(async () => {
    h = await startFwsDaemon();
  });

  afterAll(async () => {
    await h.stop();
  });

  it('gh issue list returns seeded issues', async () => {
    const { stdout, exitCode, stderr } = await h.run('gh', [
      'issue',
      'list',
      '--json',
      'number,title',
    ]);
    expect(exitCode, `gh stderr: ${stderr}`).toBe(0);
    const issues = JSON.parse(stdout);
    expect(Array.isArray(issues)).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('gh api /user returns the seeded testuser', async () => {
    const { stdout, exitCode, stderr } = await h.run('gh', ['api', '/user']);
    expect(exitCode, `gh stderr: ${stderr}`).toBe(0);
    const user = JSON.parse(stdout);
    expect(user.login).toBe('testuser');
  });

  it('curl can reach the mock server directly (no proxy)', async () => {
    const { stdout, exitCode } = await h.run('curl', [
      '-sf',
      `http://localhost:${h.port}/__fws/status`,
    ]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).status).toBe('ok');
  });
});
