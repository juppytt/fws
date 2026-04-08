import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers/harness.js';

/**
 * End-to-end validation: GitHub endpoints tested through the actual gh CLI.
 */
describe('gh CLI validation', () => {
  let h: TestHarness;

  beforeAll(async () => {
    h = await createTestHarness();
  });

  afterAll(async () => {
    await h.cleanup();
  });

  describe('REST API', () => {
    it('gh api /user', async () => {
      const { stdout, exitCode } = await h.ghProxy('api /user');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.login).toBe('testuser');
      expect(data.name).toBe('Test User');
    });

    it('gh api /repos/testuser/my-project', async () => {
      const { stdout, exitCode } = await h.ghProxy('api /repos/testuser/my-project');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.full_name).toBe('testuser/my-project');
    });

    it('gh api /repos/.../issues (list)', async () => {
      const { stdout, exitCode } = await h.ghProxy('api /repos/testuser/my-project/issues');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.length).toBeGreaterThan(0);
      expect(data.some((i: any) => i.title === 'Fix login bug')).toBe(true);
    });

    it('gh api /repos/.../issues/1 (get)', async () => {
      const { stdout, exitCode } = await h.ghProxy('api /repos/testuser/my-project/issues/1');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.title).toBe('Fix login bug');
      expect(data.state).toBe('open');
    });

    it('gh api /repos/.../issues (create)', async () => {
      const { stdout, exitCode } = await h.ghProxy('api /repos/testuser/my-project/issues -f title="Test Issue" -f body="Created by test"');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.title).toBe('Test Issue');
      expect(data.number).toBeGreaterThan(0);
    });

    it('gh api /repos/.../issues/1/comments (create)', async () => {
      const { stdout, exitCode } = await h.ghProxy('api /repos/testuser/my-project/issues/1/comments -f body="Test comment"');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.body).toBe('Test comment');
    });

    it('gh api /repos/.../issues/1/comments (list)', async () => {
      const { stdout, exitCode } = await h.ghProxy('api /repos/testuser/my-project/issues/1/comments');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.length).toBeGreaterThan(0);
    });

    it('gh api /repos/.../pulls (list)', async () => {
      const { stdout, exitCode } = await h.ghProxy('api /repos/testuser/my-project/pulls');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].title).toBe('Fix SSO login flow');
    });

    it('gh api /repos/.../pulls/3 (get)', async () => {
      const { stdout, exitCode } = await h.ghProxy('api /repos/testuser/my-project/pulls/3');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.title).toBe('Fix SSO login flow');
      expect(data.head.ref).toBe('fix/sso-login');
    });

    it('gh api /search/issues', async () => {
      const { stdout, exitCode } = await h.ghProxy('api "/search/issues?q=bug"');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.total_count).toBeGreaterThan(0);
    });

    it('gh api issue close (PATCH)', async () => {
      const { stdout, exitCode } = await h.ghProxy('api /repos/testuser/my-project/issues/2 -X PATCH -f state=closed');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.state).toBe('closed');
    });
  });

  describe('GraphQL (high-level commands)', () => {
    it('gh issue list', async () => {
      const { stdout, exitCode } = await h.ghProxyWithRepo('issue list');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Fix login bug');
    });

    it('gh issue view 1', async () => {
      const { stdout, exitCode } = await h.ghProxyWithRepo('issue view 1');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Fix login bug');
      expect(stdout).toContain('OPEN');
    });

    it('gh pr list', async () => {
      const { stdout, exitCode } = await h.ghProxyWithRepo('pr list');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Fix SSO login flow');
    });

    it('gh pr view 3', async () => {
      const { stdout, exitCode } = await h.ghProxyWithRepo('pr view 3');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Fix SSO login flow');
      expect(stdout).toContain('OPEN');
    });
  });
});
