import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers/harness.js';
import { SAMPLE_GMAIL_MESSAGE_IDS } from '../src/store/seed.js';

describe('Gmail', () => {
  let h: TestHarness;

  beforeAll(async () => {
    h = await createTestHarness();
  });

  afterAll(async () => {
    await h.cleanup();
  });

  describe('profile', () => {
    it('returns test user profile via HTTP', async () => {
      const res = await h.fetch('/gmail/v1/users/me/profile');
      const data = await res.json();
      expect(data.emailAddress).toBe('testuser@example.com');
    });

    it('returns profile via gws', async () => {
      const { stdout, exitCode } = await h.gws('gmail users getProfile --params {"userId":"me"}');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.emailAddress).toBe('testuser@example.com');
    });
  });

  describe('labels', () => {
    it('lists system labels', async () => {
      const res = await h.fetch('/gmail/v1/users/me/labels');
      const data = await res.json();
      expect(data.labels.length).toBeGreaterThanOrEqual(8);
      expect(data.labels.map((l: any) => l.id)).toContain('INBOX');
    });

    it('lists labels via gws', async () => {
      const { stdout, exitCode } = await h.gws('gmail users labels list --params {"userId":"me"}');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.labels).toBeDefined();
      expect(data.labels.map((l: any) => l.id)).toContain('INBOX');
    });

    it('creates a user label', async () => {
      const res = await h.fetch('/gmail/v1/users/me/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'TestLabel' }),
      });
      const data = await res.json();
      expect(data.name).toBe('TestLabel');
      expect(data.type).toBe('user');
      expect(data.id).toBeTruthy();
    });

    it('refuses to delete system labels', async () => {
      const res = await h.fetch('/gmail/v1/users/me/labels/INBOX', { method: 'DELETE' });
      expect(res.status).toBe(400);
    });
  });

  describe('messages', () => {
    it('lists seed messages initially', async () => {
      const res = await h.fetch('/gmail/v1/users/me/messages');
      const data = await res.json();
      expect(data.messages.length).toBe(5);
      expect(data.messages.some((m: any) => m.id === SAMPLE_GMAIL_MESSAGE_IDS[0])).toBe(true);
    });

    it('setup adds a message then list returns it', async () => {
      // Add via setup endpoint
      const setup = await h.fetch('/__fws/setup/gmail/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'alice@example.com',
          subject: 'Hello from Alice',
          body: 'Test body content',
          labels: ['INBOX', 'UNREAD'],
        }),
      });
      const { id } = await setup.json();
      expect(id).toBeTruthy();

      // List via gws
      const { stdout, exitCode } = await h.gws('gmail users messages list --params {"userId":"me"}');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.messages.length).toBeGreaterThan(0);
      expect(data.messages.some((m: any) => m.id === id)).toBe(true);
    });

    it('gets message with full format', async () => {
      const res = await h.fetch('/gmail/v1/users/me/messages');
      const list = await res.json();
      const msgId = list.messages[0].id;

      const res2 = await h.fetch(`/gmail/v1/users/me/messages/${msgId}`);
      const msg = await res2.json();
      expect(msg.id).toBe(msgId);
      expect(msg.payload).toBeDefined();
      expect(msg.payload.headers).toBeDefined();
    });

    it('gets message via gws', async () => {
      const listRes = await h.fetch('/gmail/v1/users/me/messages');
      const list = await listRes.json();
      const msgId = list.messages[0].id;

      const { stdout, exitCode } = await h.gws(`gmail users messages get --params {"userId":"me","id":"${msgId}"}`);
      expect(exitCode).toBe(0);
      const msg = JSON.parse(stdout);
      expect(msg.id).toBe(msgId);
    });

    it('sends a message', async () => {
      const raw = Buffer.from(
        'From: testuser@example.com\r\nTo: bob@example.com\r\nSubject: Test Send\r\n\r\nHello Bob'
      ).toString('base64url');

      const res = await h.fetch('/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
      });
      const data = await res.json();
      expect(data.id).toBeTruthy();
      expect(data.labelIds).toContain('SENT');
    });

    it('trashes and untrashes a message', async () => {
      // Setup a message
      const setup = await h.fetch('/__fws/setup/gmail/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'trash-test@example.com', subject: 'Trash me', body: 'x' }),
      });
      const { id } = await setup.json();

      // Trash it
      const trashRes = await h.fetch(`/gmail/v1/users/me/messages/${id}/trash`, { method: 'POST' });
      const trashed = await trashRes.json();
      expect(trashed.labelIds).toContain('TRASH');
      expect(trashed.labelIds).not.toContain('INBOX');

      // Untrash it
      const untrashRes = await h.fetch(`/gmail/v1/users/me/messages/${id}/untrash`, { method: 'POST' });
      const untrashed = await untrashRes.json();
      expect(untrashed.labelIds).toContain('INBOX');
      expect(untrashed.labelIds).not.toContain('TRASH');
    });

    it('modifies message labels', async () => {
      const setup = await h.fetch('/__fws/setup/gmail/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'modify@example.com', subject: 'Modify', body: 'x', labels: ['INBOX', 'UNREAD'] }),
      });
      const { id } = await setup.json();

      const res = await h.fetch(`/gmail/v1/users/me/messages/${id}/modify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addLabelIds: ['STARRED'], removeLabelIds: ['UNREAD'] }),
      });
      const msg = await res.json();
      expect(msg.labelIds).toContain('STARRED');
      expect(msg.labelIds).not.toContain('UNREAD');
    });

    it('deletes a message', async () => {
      const setup = await h.fetch('/__fws/setup/gmail/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'del@example.com', subject: 'Delete me', body: 'x' }),
      });
      const { id } = await setup.json();

      const res = await h.fetch(`/gmail/v1/users/me/messages/${id}`, { method: 'DELETE' });
      expect(res.status).toBe(204);

      // Verify gone
      const getRes = await h.fetch(`/gmail/v1/users/me/messages/${id}`);
      expect(getRes.status).toBe(404);
    });

    it('filters by q=from:alice', async () => {
      const res = await h.fetch('/gmail/v1/users/me/messages?q=from:alice');
      const data = await res.json();
      // At least the alice message from earlier
      expect(data.messages.length).toBeGreaterThan(0);
    });
  });

  describe('threads', () => {
    it('lists threads', async () => {
      const res = await h.fetch('/gmail/v1/users/me/threads');
      const data = await res.json();
      expect(data.threads.length).toBeGreaterThan(0);
    });

    it('gets a thread by id', async () => {
      const listRes = await h.fetch('/gmail/v1/users/me/threads');
      const list = await listRes.json();
      const threadId = list.threads[0].id;

      const res = await h.fetch(`/gmail/v1/users/me/threads/${threadId}`);
      const thread = await res.json();
      expect(thread.id).toBe(threadId);
      expect(thread.messages.length).toBeGreaterThan(0);
    });
  });
});
