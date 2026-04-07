import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers/harness.js';

/**
 * End-to-end validation: every implemented endpoint tested through the actual gws CLI.
 */
describe('gws CLI validation', () => {
  let h: TestHarness;

  beforeAll(async () => {
    h = await createTestHarness();
  });

  afterAll(async () => {
    await h.cleanup();
  });

  // ===== Gmail =====

  describe('gmail', () => {
    describe('profile', () => {
      it('gws gmail users getProfile', async () => {
        const { stdout, exitCode } = await h.gws('gmail users getProfile --params {"userId":"me"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.emailAddress).toBe('testuser@example.com');
        expect(data.messagesTotal).toBeTypeOf('number');
      });
    });

    describe('labels', () => {
      it('gws gmail users labels list', async () => {
        const { stdout, exitCode } = await h.gws('gmail users labels list --params {"userId":"me"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.labels.map((l: any) => l.id)).toContain('INBOX');
      });

      it('gws gmail users labels get', async () => {
        const { stdout, exitCode } = await h.gws('gmail users labels get --params {"userId":"me","id":"INBOX"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBe('INBOX');
        expect(data.type).toBe('system');
      });

      let createdLabelId: string;

      it('gws gmail users labels create', async () => {
        const { stdout, exitCode } = await h.gws('gmail users labels create --params {"userId":"me"} --json {"name":"GwsTestLabel"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.name).toBe('GwsTestLabel');
        expect(data.type).toBe('user');
        createdLabelId = data.id;
      });

      it('gws gmail users labels patch', async () => {
        const { stdout, exitCode } = await h.gws(`gmail users labels patch --params {"userId":"me","id":"${createdLabelId}"} --json {"name":"RenamedLabel"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.name).toBe('RenamedLabel');
      });

      it('gws gmail users labels delete', async () => {
        const { stdout, exitCode } = await h.gws(`gmail users labels delete --params {"userId":"me","id":"${createdLabelId}"}`);
        expect(exitCode).toBe(0);
      });
    });

    describe('messages', () => {
      it('gws gmail users messages list', async () => {
        const { stdout, exitCode } = await h.gws('gmail users messages list --params {"userId":"me"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.messages.length).toBeGreaterThan(0);
        expect(data.messages[0]).toHaveProperty('id');
        expect(data.messages[0]).toHaveProperty('threadId');
      });

      it('gws gmail users messages list with q filter', async () => {
        const { stdout, exitCode } = await h.gws('gmail users messages list --params {"userId":"me","q":"from:alice"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.messages.length).toBeGreaterThan(0);
      });

      it('gws gmail users messages list with maxResults', async () => {
        const { stdout, exitCode } = await h.gws('gmail users messages list --params {"userId":"me","maxResults":2}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.messages.length).toBeLessThanOrEqual(2);
      });

      it('gws gmail users messages get', async () => {
        const { stdout, exitCode } = await h.gws('gmail users messages get --params {"userId":"me","id":"msg001"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBe('msg001');
        expect(data.payload).toBeDefined();
        expect(data.payload.headers).toBeDefined();
      });

      it('gws gmail users messages get with format=minimal', async () => {
        const { stdout, exitCode } = await h.gws('gmail users messages get --params {"userId":"me","id":"msg001","format":"minimal"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBe('msg001');
        expect(data.labelIds).toBeDefined();
        expect(data.payload).toBeUndefined();
      });

      it('gws gmail users messages send', async () => {
        const raw = Buffer.from(
          'From: testuser@example.com\r\nTo: bob@example.com\r\nSubject: Gws Send Test\r\n\r\nHello from gws'
        ).toString('base64url');
        const { stdout, exitCode } = await h.gws(`gmail users messages send --params {"userId":"me"} --json {"raw":"${raw}"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBeTruthy();
        expect(data.labelIds).toContain('SENT');
      });

      it('gws gmail users messages modify', async () => {
        const { stdout, exitCode } = await h.gws('gmail users messages modify --params {"userId":"me","id":"msg001"} --json {"addLabelIds":["STARRED"],"removeLabelIds":["UNREAD"]}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.labelIds).toContain('STARRED');
        expect(data.labelIds).not.toContain('UNREAD');
      });

      it('gws gmail users messages trash', async () => {
        // Setup a message to trash
        await h.fetch('/__fws/setup/gmail/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'trash-gws@test.com', subject: 'Trash via gws', body: 'x' }),
        });
        const listRes = await h.fetch('/gmail/v1/users/me/messages?q=from:trash-gws@test.com');
        const list = await listRes.json();
        const msgId = list.messages[0].id;

        const { stdout, exitCode } = await h.gws(`gmail users messages trash --params {"userId":"me","id":"${msgId}"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.labelIds).toContain('TRASH');
      });

      it('gws gmail users messages untrash', async () => {
        const listRes = await h.fetch('/gmail/v1/users/me/messages?q=from:trash-gws@test.com');
        const list = await listRes.json();
        // Find trashed message
        const getRes = await h.fetch(`/gmail/v1/users/me/messages/${list.messages[0].id}`);
        const msg = await getRes.json();
        if (!msg.labelIds.includes('TRASH')) return; // already untrashed

        const { stdout, exitCode } = await h.gws(`gmail users messages untrash --params {"userId":"me","id":"${msg.id}"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.labelIds).not.toContain('TRASH');
      });

      it('gws gmail users messages delete', async () => {
        // Create a throwaway message
        const setup = await h.fetch('/__fws/setup/gmail/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'del-gws@test.com', subject: 'Delete via gws', body: 'x' }),
        });
        const { id } = await setup.json();

        const { exitCode } = await h.gws(`gmail users messages delete --params {"userId":"me","id":"${id}"}`);
        expect(exitCode).toBe(0);

        // Verify deleted
        const getRes = await h.fetch(`/gmail/v1/users/me/messages/${id}`);
        expect(getRes.status).toBe(404);
      });

      it('gws gmail users messages insert', async () => {
        const raw = Buffer.from(
          'From: external@test.com\r\nTo: testuser@example.com\r\nSubject: Inserted\r\n\r\nInserted body'
        ).toString('base64url');
        const { stdout, exitCode } = await h.gws(`gmail users messages insert --params {"userId":"me"} --json {"raw":"${raw}"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBeTruthy();
      });
    });

    describe('threads', () => {
      it('gws gmail users threads list', async () => {
        const { stdout, exitCode } = await h.gws('gmail users threads list --params {"userId":"me"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.threads.length).toBeGreaterThan(0);
        expect(data.threads[0]).toHaveProperty('id');
      });

      it('gws gmail users threads get', async () => {
        const { stdout, exitCode } = await h.gws('gmail users threads get --params {"userId":"me","id":"thread001"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBe('thread001');
        expect(data.messages.length).toBeGreaterThan(0);
      });
    });

    describe('helpers', () => {
      it('gws gmail +triage', async () => {
        const { stdout, exitCode } = await h.gwsProxy('gmail +triage --max 3 --format json');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.messages.length).toBeGreaterThan(0);
        expect(data.messages[0]).toHaveProperty('subject');
        expect(data.messages[0]).toHaveProperty('from');
      });

      it('gws gmail +send', async () => {
        const { stdout, exitCode } = await h.gwsProxy('gmail +send --to bob@example.com --subject "Test send" --body "Hello"');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBeTruthy();
        expect(data.labelIds).toContain('SENT');
      });

      it('gws gmail +reply', async () => {
        const { stdout, exitCode } = await h.gwsProxy('gmail +reply --message-id msg001 --body "Got it"');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBeTruthy();
        expect(data.threadId).toBe('thread001');
      });

      it('gws gmail +reply-all', async () => {
        const { stdout, exitCode } = await h.gwsProxy('gmail +reply-all --message-id msg001 --body "Sounds good"');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBeTruthy();
        expect(data.threadId).toBe('thread001');
      });

      it('gws gmail +forward', async () => {
        const { stdout, exitCode } = await h.gwsProxy('gmail +forward --message-id msg001 --to carol@example.com --body "FYI"');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBeTruthy();
        expect(data.threadId).toBe('thread001');
      });
    });

    describe('settings', () => {
      it('gws gmail users settings sendAs list', async () => {
        const { stdout, exitCode } = await h.gws('gmail users settings sendAs list --params {"userId":"me"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.sendAs.length).toBeGreaterThan(0);
        expect(data.sendAs[0].sendAsEmail).toBe('testuser@example.com');
      });
    });

    describe('drafts', () => {
      it('gws gmail users drafts list', async () => {
        const { stdout, exitCode } = await h.gws('gmail users drafts list --params {"userId":"me"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.drafts).toBeDefined();
      });

      let draftId: string;

      it('gws gmail users drafts create', async () => {
        const raw = Buffer.from(
          'From: testuser@example.com\r\nTo: bob@example.com\r\nSubject: Draft Test\r\n\r\nDraft body'
        ).toString('base64url');
        const { stdout, exitCode } = await h.gws(`gmail users drafts create --params {"userId":"me"} --json {"message":{"raw":"${raw}"}}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBeTruthy();
        draftId = data.id;
      });

      it('gws gmail users drafts get', async () => {
        const { stdout, exitCode } = await h.gws(`gmail users drafts get --params {"userId":"me","id":"${draftId}"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBe(draftId);
      });

      it('gws gmail users drafts delete', async () => {
        const { exitCode } = await h.gws(`gmail users drafts delete --params {"userId":"me","id":"${draftId}"}`);
        expect(exitCode).toBe(0);
      });
    });

    describe('history', () => {
      it('gws gmail users history list', async () => {
        const { stdout, exitCode } = await h.gws('gmail users history list --params {"userId":"me","startHistoryId":"1000"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.history).toBeDefined();
        expect(data.historyId).toBeDefined();
      });
    });
  });

  // ===== Calendar =====

  describe('calendar', () => {
    describe('calendarList', () => {
      it('gws calendar calendarList list', async () => {
        const { stdout, exitCode } = await h.gws('calendar calendarList list');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.items.length).toBeGreaterThan(0);
        expect(data.items.some((c: any) => c.primary)).toBe(true);
      });

      it('gws calendar calendarList get', async () => {
        const { stdout, exitCode } = await h.gws('calendar calendarList get --params {"calendarId":"testuser@example.com"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBe('testuser@example.com');
      });
    });

    describe('calendars', () => {
      let newCalId: string;

      it('gws calendar calendars insert', async () => {
        const { stdout, exitCode } = await h.gws('calendar calendars insert --json {"summary":"GWS Test Calendar"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.summary).toBe('GWS Test Calendar');
        newCalId = data.id;
      });

      it('gws calendar calendars get', async () => {
        const { stdout, exitCode } = await h.gws(`calendar calendars get --params {"calendarId":"${newCalId}"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBe(newCalId);
      });

      it('gws calendar calendars patch', async () => {
        const { stdout, exitCode } = await h.gws(`calendar calendars patch --params {"calendarId":"${newCalId}"} --json {"summary":"Patched Calendar"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.summary).toBe('Patched Calendar');
      });

      it('gws calendar calendars delete', async () => {
        const { exitCode } = await h.gws(`calendar calendars delete --params {"calendarId":"${newCalId}"}`);
        expect(exitCode).toBe(0);
      });
    });

    describe('events', () => {
      it('gws calendar events list', async () => {
        const { stdout, exitCode } = await h.gws('calendar events list --params {"calendarId":"primary"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.items.length).toBeGreaterThan(0);
      });

      it('gws calendar events list with timeMin', async () => {
        const { stdout, exitCode } = await h.gws('calendar events list --params {"calendarId":"primary","timeMin":"2026-04-09T00:00:00Z"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        // Should exclude events before Apr 9
        const summaries = data.items.map((e: any) => e.summary);
        expect(summaries).not.toContain('Daily Standup'); // Apr 8 09:00
      });

      let newEventId: string;

      it('gws calendar events insert', async () => {
        const { stdout, exitCode } = await h.gws('calendar events insert --params {"calendarId":"primary"} --json {"summary":"GWS Event","start":{"dateTime":"2026-05-01T10:00:00Z"},"end":{"dateTime":"2026-05-01T11:00:00Z"}}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.summary).toBe('GWS Event');
        newEventId = data.id;
      });

      it('gws calendar events get', async () => {
        const { stdout, exitCode } = await h.gws(`calendar events get --params {"calendarId":"primary","eventId":"${newEventId}"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.summary).toBe('GWS Event');
      });

      it('gws calendar events patch', async () => {
        const { stdout, exitCode } = await h.gws(`calendar events patch --params {"calendarId":"primary","eventId":"${newEventId}"} --json {"summary":"Patched Event"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.summary).toBe('Patched Event');
      });

      it('gws calendar events update (PUT)', async () => {
        const { stdout, exitCode } = await h.gws(`calendar events update --params {"calendarId":"primary","eventId":"${newEventId}"} --json {"summary":"Replaced Event","start":{"dateTime":"2026-05-01T10:00:00Z"},"end":{"dateTime":"2026-05-01T11:00:00Z"}}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.summary).toBe('Replaced Event');
      });

      it('gws calendar events delete', async () => {
        const { exitCode } = await h.gws(`calendar events delete --params {"calendarId":"primary","eventId":"${newEventId}"}`);
        expect(exitCode).toBe(0);
      });
    });
  });

  // ===== Drive =====

  describe('drive', () => {
    describe('about', () => {
      it('gws drive about get', async () => {
        const { stdout, exitCode } = await h.gws('drive about get --params {"fields":"*"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.kind).toBe('drive#about');
        expect(data.user.emailAddress).toBe('testuser@example.com');
      });
    });

    describe('files', () => {
      it('gws drive files list', async () => {
        const { stdout, exitCode } = await h.gws('drive files list');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.files.length).toBeGreaterThan(0);
      });

      it('gws drive files list with q filter', async () => {
        const { stdout, exitCode } = await h.gws(`drive files list --params {"q":"name contains 'Budget'"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.files.length).toBe(1);
        expect(data.files[0].name).toContain('Budget');
      });

      let newFileId: string;

      it('gws drive files create', async () => {
        const { stdout, exitCode } = await h.gws('drive files create --json {"name":"gws-created.txt","mimeType":"text/plain"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.name).toBe('gws-created.txt');
        newFileId = data.id;
      });

      it('gws drive files get', async () => {
        const { stdout, exitCode } = await h.gws(`drive files get --params {"fileId":"${newFileId}"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.name).toBe('gws-created.txt');
      });

      it('gws drive files update (PATCH)', async () => {
        const { stdout, exitCode } = await h.gws(`drive files update --params {"fileId":"${newFileId}"} --json {"name":"gws-renamed.txt"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.name).toBe('gws-renamed.txt');
      });

      it('gws drive files copy', async () => {
        const { stdout, exitCode } = await h.gws(`drive files copy --params {"fileId":"${newFileId}"} --json {"name":"gws-copy.txt"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.name).toBe('gws-copy.txt');
        expect(data.id).not.toBe(newFileId);
      });

      it('gws drive files delete', async () => {
        const { exitCode } = await h.gws(`drive files delete --params {"fileId":"${newFileId}"}`);
        expect(exitCode).toBe(0);
      });
    });
  });
});
