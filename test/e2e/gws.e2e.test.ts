import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFwsDaemon, type CliHarness } from './helpers/cli-harness.js';

/**
 * E2E coverage for the `gws` (Google Workspace) CLI against the real
 * `fws server start` daemon. Mirrors the structure of test/gws-validation.test.ts
 * but talks to a real daemon instead of an in-process Express app, so it
 * exercises:
 *
 *  - the discovery cache rewritten on disk by `fws server start`
 *  - the MITM proxy across processes (helpers like +triage / +send /
 *    +reply / +forward go via HTTPS_PROXY)
 *  - keep-alive across multiple requests per host (regression: #7)
 *
 * The coverage is intentionally broad rather than exhaustive: one or two
 * representative commands per resource is enough to catch daemon-mode
 * regressions, since the in-process suite already covers each command's
 * surface in detail.
 */
describe('e2e: gws CLI against real daemon', () => {
  let h: CliHarness;

  beforeAll(async () => {
    h = await startFwsDaemon();
  });

  afterAll(async () => {
    await h.stop();
  });

  // ===== Gmail =====

  describe('gmail', () => {
    // Seed IDs are generated randomly by the daemon process, so fetch them
    // via the list endpoint once and reuse for get/reply/forward tests.
    let seedMessageId: string;
    let seedThreadId: string;

    beforeAll(async () => {
      const { stdout, stderr, exitCode } = await h.runStr(
        'gws', 'gmail users messages list --params {"userId":"me"}',
      );
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.messages.length).toBeGreaterThan(0);
      const { stdout: getOut } = await h.runStr(
        'gws', `gmail users messages get --params {"userId":"me","id":"${data.messages[0].id}"}`,
      );
      const msg = JSON.parse(getOut);
      seedMessageId = msg.id;
      seedThreadId = msg.threadId;
    });

    it('users getProfile', async () => {
      const { stdout, stderr, exitCode } = await h.runStr(
        'gws', 'gmail users getProfile --params {"userId":"me"}',
      );
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.emailAddress).toBe('testuser@example.com');
    });

    it('users labels list', async () => {
      const { stdout, stderr, exitCode } = await h.runStr(
        'gws', 'gmail users labels list --params {"userId":"me"}',
      );
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.labels.map((l: any) => l.id)).toContain('INBOX');
    });

    it('users labels create + delete', async () => {
      const { stdout, stderr, exitCode } = await h.runStr(
        'gws', 'gmail users labels create --params {"userId":"me"} --json {"name":"E2eLabel"}',
      );
      expect(exitCode, stderr).toBe(0);
      const created = JSON.parse(stdout);
      expect(created.name).toBe('E2eLabel');

      const del = await h.runStr(
        'gws', `gmail users labels delete --params {"userId":"me","id":"${created.id}"}`,
      );
      expect(del.exitCode, del.stderr).toBe(0);
    });

    it('users messages list', async () => {
      const { stdout, stderr, exitCode } = await h.runStr(
        'gws', 'gmail users messages list --params {"userId":"me"}',
      );
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data.messages)).toBe(true);
      expect(data.messages.length).toBeGreaterThan(0);
    });

    it('users messages get', async () => {
      const { stdout, stderr, exitCode } = await h.runStr(
        'gws', `gmail users messages get --params {"userId":"me","id":"${seedMessageId}"}`,
      );
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.id).toBe(seedMessageId);
      expect(data.payload.headers.some((h: any) => h.name === 'Subject')).toBe(true);
    });

    it('users threads list', async () => {
      const { stdout, stderr, exitCode } = await h.runStr(
        'gws', 'gmail users threads list --params {"userId":"me"}',
      );
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data.threads)).toBe(true);
    });

    // ===== Helpers (multipart upload path — was the gws 0.16 → 0.22 break) =====

    describe('helpers', () => {
      it('+triage', async () => {
        const { stdout, stderr, exitCode } = await h.runStr(
          'gws', 'gmail +triage --max 3 --format json',
        );
        expect(exitCode, stderr).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.messages.length).toBeGreaterThan(0);
        expect(data.messages[0]).toHaveProperty('subject');
      });

      it('+send', async () => {
        const { stdout, stderr, exitCode } = await h.runStr(
          'gws', 'gmail +send --to bob@example.com --subject "E2E send" --body "Hello from e2e"',
        );
        expect(exitCode, stderr).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBeTruthy();
        expect(data.labelIds).toContain('SENT');
      });

      it('+reply', async () => {
        const { stdout, stderr, exitCode } = await h.runStr(
          'gws', `gmail +reply --message-id ${seedMessageId} --body "E2E reply"`,
        );
        expect(exitCode, stderr).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBeTruthy();
        expect(data.threadId).toBe(seedThreadId);
      });

      it('+reply-all', async () => {
        const { stdout, stderr, exitCode } = await h.runStr(
          'gws', `gmail +reply-all --message-id ${seedMessageId} --body "E2E reply-all"`,
        );
        expect(exitCode, stderr).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.threadId).toBe(seedThreadId);
      });

      it('+forward', async () => {
        const { stdout, stderr, exitCode } = await h.runStr(
          'gws', `gmail +forward --message-id ${seedMessageId} --to carol@example.com --body "E2E fwd"`,
        );
        expect(exitCode, stderr).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.threadId).toBe(seedThreadId);
      });
    });
  });

  // ===== Calendar =====

  describe('calendar', () => {
    it('calendarList list', async () => {
      const { stdout, stderr, exitCode } = await h.runStr('gws', 'calendar calendarList list');
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.items.length).toBeGreaterThan(0);
      expect(data.items.some((c: any) => c.primary)).toBe(true);
    });

    it('events list', async () => {
      const { stdout, stderr, exitCode } = await h.runStr(
        'gws', 'calendar events list --params {"calendarId":"primary"}',
      );
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data.items)).toBe(true);
    });

    it('events insert', async () => {
      const { stdout, stderr, exitCode } = await h.runStr(
        'gws',
        'calendar events insert --params {"calendarId":"primary"} --json {"summary":"E2E meeting","start":{"dateTime":"2026-05-01T10:00:00Z"},"end":{"dateTime":"2026-05-01T11:00:00Z"}}',
      );
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.summary).toBe('E2E meeting');
      expect(data.id).toBeTruthy();
    });
  });

  // ===== Drive =====

  describe('drive', () => {
    it('files list', async () => {
      const { stdout, stderr, exitCode } = await h.runStr('gws', 'drive files list');
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data.files)).toBe(true);
      expect(data.files.length).toBeGreaterThan(0);
    });

    it('files get', async () => {
      const list = await h.runStr('gws', 'drive files list');
      const fileId = JSON.parse(list.stdout).files[0].id;

      const { stdout, stderr, exitCode } = await h.runStr(
        'gws', `drive files get --params {"fileId":"${fileId}"}`,
      );
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.id).toBe(fileId);
    });

    it('about get', async () => {
      const { stdout, stderr, exitCode } = await h.runStr(
        'gws', 'drive about get --params {"fields":"user,storageQuota"}',
      );
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.user).toBeTruthy();
    });
  });

  // ===== Tasks =====

  describe('tasks', () => {
    it('tasklists list', async () => {
      const { stdout, stderr, exitCode } = await h.runStr('gws', 'tasks tasklists list');
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.items.length).toBeGreaterThan(0);
    });

    it('tasks list', async () => {
      const { stdout, stderr, exitCode } = await h.runStr(
        'gws', 'tasks tasks list --params {"tasklist":"default"}',
      );
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data.items)).toBe(true);
    });
  });

  // ===== Sheets =====

  describe('sheets', () => {
    it('spreadsheets get', async () => {
      const { stdout, stderr, exitCode } = await h.runStr(
        'gws', 'sheets spreadsheets get --params {"spreadsheetId":"sheet001"}',
      );
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.spreadsheetId).toBe('sheet001');
      expect(data.properties.title).toBe('Budget 2026');
    });
  });

  // ===== People =====

  describe('people', () => {
    it('people connections list', async () => {
      const { stdout, stderr, exitCode } = await h.runStr(
        'gws',
        'people people connections list --params {"resourceName":"people/me","personFields":"names,emailAddresses"}',
      );
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data.connections)).toBe(true);
    });

    it('contactGroups list', async () => {
      const { stdout, stderr, exitCode } = await h.runStr('gws', 'people contactGroups list');
      expect(exitCode, stderr).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data.contactGroups)).toBe(true);
    });
  });
});
