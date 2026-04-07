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

      it('gws gmail users labels update (PUT)', async () => {
        const { stdout, exitCode } = await h.gws(`gmail users labels update --params {"userId":"me","id":"${createdLabelId}"} --json {"name":"PutLabel","messageListVisibility":"show","labelListVisibility":"labelShow"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.name).toBe('PutLabel');
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

      it('gws gmail users messages import', async () => {
        const raw = Buffer.from(
          'From: imported@test.com\r\nTo: testuser@example.com\r\nSubject: Imported\r\n\r\nImported body'
        ).toString('base64url');
        const { stdout, exitCode } = await h.gws(`gmail users messages import --params {"userId":"me"} --json {"raw":"${raw}"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBeTruthy();
      });

      it('gws gmail users messages batchModify', async () => {
        // Create two messages
        const s1 = await h.fetch('/__fws/setup/gmail/message', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'batch1@test.com', subject: 'Batch 1', body: 'x', labels: ['INBOX'] }),
        });
        const s2 = await h.fetch('/__fws/setup/gmail/message', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'batch2@test.com', subject: 'Batch 2', body: 'x', labels: ['INBOX'] }),
        });
        const id1 = (await s1.json()).id;
        const id2 = (await s2.json()).id;

        const { exitCode } = await h.gws(`gmail users messages batchModify --params {"userId":"me"} --json {"ids":["${id1}","${id2}"],"addLabelIds":["STARRED"]}`);
        expect(exitCode).toBe(0);

        // Verify both starred
        const g1 = await h.fetch(`/gmail/v1/users/me/messages/${id1}`);
        expect((await g1.json()).labelIds).toContain('STARRED');
        const g2 = await h.fetch(`/gmail/v1/users/me/messages/${id2}`);
        expect((await g2.json()).labelIds).toContain('STARRED');
      });

      it('gws gmail users messages batchDelete', async () => {
        const s1 = await h.fetch('/__fws/setup/gmail/message', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'batchdel@test.com', subject: 'Del 1', body: 'x' }),
        });
        const s2 = await h.fetch('/__fws/setup/gmail/message', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'batchdel@test.com', subject: 'Del 2', body: 'x' }),
        });
        const id1 = (await s1.json()).id;
        const id2 = (await s2.json()).id;

        const { exitCode } = await h.gws(`gmail users messages batchDelete --params {"userId":"me"} --json {"ids":["${id1}","${id2}"]}`);
        expect(exitCode).toBe(0);

        // Verify both deleted
        expect((await h.fetch(`/gmail/v1/users/me/messages/${id1}`)).status).toBe(404);
        expect((await h.fetch(`/gmail/v1/users/me/messages/${id2}`)).status).toBe(404);
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

      it('gws gmail users threads modify', async () => {
        const { stdout, exitCode } = await h.gws('gmail users threads modify --params {"userId":"me","id":"thread001"} --json {"addLabelIds":["STARRED"]}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.messages[0].labelIds).toContain('STARRED');
      });

      it('gws gmail users threads trash', async () => {
        // Setup a thread to trash
        await h.fetch('/__fws/setup/gmail/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'thread-trash@test.com', subject: 'Thread trash', body: 'x' }),
        });
        const listRes = await h.fetch('/gmail/v1/users/me/messages?q=from:thread-trash@test.com');
        const list = await listRes.json();
        const threadId = list.messages[0].threadId;

        const { stdout, exitCode } = await h.gws(`gmail users threads trash --params {"userId":"me","id":"${threadId}"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.messages[0].labelIds).toContain('TRASH');
      });

      it('gws gmail users threads untrash', async () => {
        const listRes = await h.fetch('/gmail/v1/users/me/messages?q=from:thread-trash@test.com');
        const list = await listRes.json();
        const threadId = list.messages[0].threadId;

        const { stdout, exitCode } = await h.gws(`gmail users threads untrash --params {"userId":"me","id":"${threadId}"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.messages[0].labelIds).not.toContain('TRASH');
      });

      it('gws gmail users threads delete', async () => {
        const listRes = await h.fetch('/gmail/v1/users/me/messages?q=from:thread-trash@test.com');
        const list = await listRes.json();
        const threadId = list.messages[0].threadId;

        const { exitCode } = await h.gws(`gmail users threads delete --params {"userId":"me","id":"${threadId}"}`);
        expect(exitCode).toBe(0);
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

      it('gws calendar calendarList patch', async () => {
        const { stdout, exitCode } = await h.gws('calendar calendarList patch --params {"calendarId":"testuser@example.com"} --json {"colorId":"9"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBe('testuser@example.com');
      });

      it('gws calendar calendarList delete + insert', async () => {
        // Create a calendar, delete from list, re-insert
        const createRes = await h.fetch('/calendar/v3/calendars', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: 'ListTest' }),
        });
        const cal = await createRes.json();

        // Delete from list
        const { exitCode: delCode } = await h.gws(`calendar calendarList delete --params {"calendarId":"${cal.id}"}`);
        expect(delCode).toBe(0);

        // Re-insert
        const { stdout, exitCode } = await h.gws(`calendar calendarList insert --json {"id":"${cal.id}"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.id).toBe(cal.id);
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

      it('gws calendar calendars update (PUT)', async () => {
        const { stdout, exitCode } = await h.gws(`calendar calendars update --params {"calendarId":"${newCalId}"} --json {"summary":"PUT Calendar","timeZone":"America/New_York"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.summary).toBe('PUT Calendar');
      });

      it('gws calendar calendars clear', async () => {
        // Add an event first
        await h.fetch(`/calendar/v3/calendars/${newCalId}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: 'To clear', start: { dateTime: '2026-06-01T10:00:00Z' }, end: { dateTime: '2026-06-01T11:00:00Z' } }),
        });
        const { exitCode } = await h.gws(`calendar calendars clear --params {"calendarId":"${newCalId}"}`);
        expect(exitCode).toBe(0);
        // Verify events cleared
        const eventsRes = await h.fetch(`/calendar/v3/calendars/${newCalId}/events`);
        const events = await eventsRes.json();
        expect(events.items.length).toBe(0);
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

      it('gws calendar events import', async () => {
        const { stdout, exitCode } = await h.gws('calendar events import --params {"calendarId":"primary"} --json {"summary":"Imported Event","start":{"dateTime":"2026-07-01T10:00:00Z"},"end":{"dateTime":"2026-07-01T11:00:00Z"},"iCalUID":"imported@example.com"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.summary).toBe('Imported Event');
        expect(data.iCalUID).toBe('imported@example.com');
      });

      it('gws calendar events quickAdd', async () => {
        const { stdout, exitCode } = await h.gws('calendar events quickAdd --params {"calendarId":"primary","text":"Lunch with Alice"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.summary).toBe('Lunch with Alice');
      });

      it('gws calendar events move', async () => {
        // Create event in primary, create second calendar, move event
        const evtRes = await h.fetch('/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: 'Move me', start: { dateTime: '2026-08-01T10:00:00Z' }, end: { dateTime: '2026-08-01T11:00:00Z' } }),
        });
        const evt = await evtRes.json();

        const calRes = await h.fetch('/calendar/v3/calendars', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: 'Dest Calendar' }),
        });
        const destCal = await calRes.json();

        const { stdout, exitCode } = await h.gws(`calendar events move --params {"calendarId":"primary","eventId":"${evt.id}","destination":"${destCal.id}"}`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.summary).toBe('Move me');

        // Verify moved to dest
        const destEventsRes = await h.fetch(`/calendar/v3/calendars/${destCal.id}/events`);
        const destEvents = await destEventsRes.json();
        expect(destEvents.items.some((e: any) => e.id === evt.id)).toBe(true);
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

      it('gws drive files emptyTrash', async () => {
        // Create and trash a file
        const createRes = await h.fetch('/drive/v3/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'trash-me.txt' }),
        });
        const file = await createRes.json();
        await h.fetch(`/drive/v3/files/${file.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trashed: true }),
        });

        const { exitCode } = await h.gws('drive files emptyTrash');
        expect(exitCode).toBe(0);

        // Verify trashed file is gone
        const getRes = await h.fetch(`/drive/v3/files/${file.id}`);
        expect(getRes.status).toBe(404);
      });
    });

    describe('permissions', () => {
      it('gws drive permissions list', async () => {
        const { stdout, exitCode } = await h.gws('drive permissions list --params {"fileId":"file001"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.permissions.length).toBeGreaterThan(0);
        expect(data.permissions[0].role).toBe('owner');
      });

      it('gws drive permissions create', async () => {
        const { stdout, exitCode } = await h.gws('drive permissions create --params {"fileId":"file001"} --json {"type":"user","role":"reader","emailAddress":"reader@example.com"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.role).toBe('reader');
        expect(data.emailAddress).toBe('reader@example.com');
      });

      it('gws drive permissions get', async () => {
        const { stdout, exitCode } = await h.gws('drive permissions get --params {"fileId":"file001","permissionId":"owner"}');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.role).toBe('owner');
      });
    });

    describe('drives', () => {
      it('gws drive drives list', async () => {
        const { stdout, exitCode } = await h.gws('drive drives list');
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.drives).toBeDefined();
      });
    });
  });
});
