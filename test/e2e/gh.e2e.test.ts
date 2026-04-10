import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFwsDaemon, type CliHarness } from './helpers/cli-harness.js';

/**
 * E2E coverage for the `gh` CLI against the real `fws server start` daemon
 * (not the in-process Express harness). Mirrors test/gh-validation.test.ts
 * but exercises the daemon path: detached spawn, on-disk certs, MITM proxy
 * across processes.
 */
describe('e2e: gh CLI against real daemon', () => {
  let h: CliHarness;

  beforeAll(async () => {
    h = await startFwsDaemon();
  });

  afterAll(async () => {
    await h.stop();
  });

  describe('REST API (gh api)', () => {
    it('gh api /user', async () => {
      const { stdout, stderr, exitCode } = await h.runStr('gh', 'api /user');
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.login).toBe('testuser');
      expect(data.name).toBe('Test User');
    });

    it('gh api /repos/testuser/my-project', async () => {
      const { stdout, stderr, exitCode } = await h.runStr('gh', 'api /repos/testuser/my-project');
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.full_name).toBe('testuser/my-project');
    });

    it('gh api .../issues (list)', async () => {
      const { stdout, stderr, exitCode } = await h.runStr('gh', 'api /repos/testuser/my-project/issues');
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.length).toBeGreaterThan(0);
      expect(data.some((i: any) => i.title === 'Fix login bug')).toBe(true);
    });

    it('gh api .../issues/1 (get)', async () => {
      const { stdout, stderr, exitCode } = await h.runStr('gh', 'api /repos/testuser/my-project/issues/1');
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.title).toBe('Fix login bug');
      expect(data.state).toBe('open');
    });

    it('gh api .../issues (create)', async () => {
      const { stdout, stderr, exitCode } = await h.run('gh', [
        'api',
        '--method', 'POST',
        '/repos/testuser/my-project/issues',
        '-f', 'title=e2e created issue',
        '-f', 'body=created from gh-e2e.test.ts',
      ]);
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.title).toBe('e2e created issue');
      expect(data.number).toBeTypeOf('number');
    });

    it('gh api .../issues/1/comments (create + list)', async () => {
      const { stderr: cErr, exitCode: cCode } = await h.run('gh', [
        'api',
        '--method', 'POST',
        '/repos/testuser/my-project/issues/1/comments',
        '-f', 'body=e2e comment',
      ]);
      expect(cCode, cErr).toBe(0);

      const { stdout, stderr, exitCode } = await h.runStr('gh', 'api /repos/testuser/my-project/issues/1/comments');
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.some((c: any) => c.body === 'e2e comment')).toBe(true);
    });

    it('gh api .../pulls (list)', async () => {
      const { stdout, stderr, exitCode } = await h.runStr('gh', 'api /repos/testuser/my-project/pulls');
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.length).toBeGreaterThan(0);
    });

    it('gh api .../pulls/3 (get)', async () => {
      const { stdout, stderr, exitCode } = await h.runStr('gh', 'api /repos/testuser/my-project/pulls/3');
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.number).toBe(3);
    });

    it('gh api /search/issues', async () => {
      const { stdout, stderr, exitCode } = await h.runStr('gh', 'api /search/issues?q=fix');
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.total_count).toBeTypeOf('number');
    });

    it('gh api PATCH issue close', async () => {
      const { stdout, stderr, exitCode } = await h.run('gh', [
        'api',
        '--method', 'PATCH',
        '/repos/testuser/my-project/issues/2',
        '-f', 'state=closed',
      ]);
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.state).toBe('closed');
    });
  });

  describe('GraphQL (gh issue / pr commands)', () => {
    it('gh issue list', async () => {
      const { stdout, stderr, exitCode } = await h.runStr('gh', 'issue list');
      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain('Fix login bug');
    });

    it('gh issue view 1', async () => {
      // Regression smoke for #7 (MITM keep-alive). gh issue view fires two
      // GraphQL requests on the same TLS connection.
      const { stdout, stderr, exitCode } = await h.runStr('gh', 'issue view 1');
      expect(exitCode, `gh stderr: ${stderr}`).toBe(0);
      expect(stdout).toContain('Fix login bug');
      expect(stdout).toContain('OPEN');
    });

    it('gh pr list', async () => {
      const { stdout, stderr, exitCode } = await h.runStr('gh', 'pr list');
      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain('Fix SSO login flow');
    });

    it('gh pr view 3', async () => {
      const { stdout, stderr, exitCode } = await h.runStr('gh', 'pr view 3');
      expect(exitCode, `gh stderr: ${stderr}`).toBe(0);
      expect(stdout).toContain('Fix SSO login flow');
      expect(stdout).toContain('OPEN');
    });

    it('gh issue list --json', async () => {
      const { stdout, stderr, exitCode } = await h.run('gh', [
        'issue', 'list', '--json', 'number,title,state',
      ]);
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty('number');
      expect(data[0]).toHaveProperty('title');
    });
  });
});
