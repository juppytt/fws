import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers/harness.js';

describe('Calendar', () => {
  let h: TestHarness;

  beforeAll(async () => {
    h = await createTestHarness();
  });

  afterAll(async () => {
    await h.cleanup();
  });

  describe('calendarList', () => {
    it('lists primary calendar', async () => {
      const res = await h.fetch('/calendar/v3/users/me/calendarList');
      const data = await res.json();
      expect(data.items.length).toBeGreaterThan(0);
      expect(data.items.some((c: any) => c.primary)).toBe(true);
    });

    it('lists via gws', async () => {
      const { stdout, exitCode } = await h.gws('calendar calendarList list');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.items.length).toBeGreaterThan(0);
    });
  });

  describe('calendars', () => {
    it('creates a calendar', async () => {
      const res = await h.fetch('/calendar/v3/calendars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: 'Work Calendar' }),
      });
      const cal = await res.json();
      expect(cal.summary).toBe('Work Calendar');
      expect(cal.id).toBeTruthy();
    });

    it('gets calendar by id', async () => {
      const listRes = await h.fetch('/calendar/v3/users/me/calendarList');
      const list = await listRes.json();
      const calId = list.items[0].id;

      const res = await h.fetch(`/calendar/v3/calendars/${calId}`);
      const cal = await res.json();
      expect(cal.id).toBe(calId);
    });

    it('patches calendar summary', async () => {
      // Create then patch
      const createRes = await h.fetch('/calendar/v3/calendars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: 'Old Name' }),
      });
      const cal = await createRes.json();

      const patchRes = await h.fetch(`/calendar/v3/calendars/${cal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: 'New Name' }),
      });
      const patched = await patchRes.json();
      expect(patched.summary).toBe('New Name');
    });

    it('deletes calendar and its events', async () => {
      const createRes = await h.fetch('/calendar/v3/calendars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: 'Delete Me' }),
      });
      const cal = await createRes.json();

      const delRes = await h.fetch(`/calendar/v3/calendars/${cal.id}`, { method: 'DELETE' });
      expect(delRes.status).toBe(204);

      const getRes = await h.fetch(`/calendar/v3/calendars/${cal.id}`);
      expect(getRes.status).toBe(404);
    });
  });

  describe('events', () => {
    it('lists empty events on primary calendar', async () => {
      const res = await h.fetch('/calendar/v3/calendars/primary/events');
      const data = await res.json();
      expect(data.items || []).toEqual([]);
    });

    it('lists events via gws', async () => {
      const { stdout, exitCode } = await h.gws('calendar events list --params {"calendarId":"primary"}');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.items).toBeDefined();
    });

    it('creates an event', async () => {
      const res = await h.fetch('/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: 'Team Meeting',
          start: { dateTime: '2026-04-08T09:00:00Z' },
          end: { dateTime: '2026-04-08T10:00:00Z' },
        }),
      });
      const event = await res.json();
      expect(event.summary).toBe('Team Meeting');
      expect(event.id).toBeTruthy();
    });

    it('gets event by id', async () => {
      // Create first
      const createRes = await h.fetch('/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: 'Get Test',
          start: { dateTime: '2026-04-09T14:00:00Z' },
          end: { dateTime: '2026-04-09T15:00:00Z' },
        }),
      });
      const event = await createRes.json();

      const getRes = await h.fetch(`/calendar/v3/calendars/primary/events/${event.id}`);
      const got = await getRes.json();
      expect(got.summary).toBe('Get Test');
    });

    it('patches event', async () => {
      const createRes = await h.fetch('/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: 'Before Patch',
          start: { dateTime: '2026-04-10T10:00:00Z' },
          end: { dateTime: '2026-04-10T11:00:00Z' },
        }),
      });
      const event = await createRes.json();

      const patchRes = await h.fetch(`/calendar/v3/calendars/primary/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: 'After Patch' }),
      });
      const patched = await patchRes.json();
      expect(patched.summary).toBe('After Patch');
    });

    it('deletes event', async () => {
      const createRes = await h.fetch('/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: 'Delete Event',
          start: { dateTime: '2026-04-11T10:00:00Z' },
          end: { dateTime: '2026-04-11T11:00:00Z' },
        }),
      });
      const event = await createRes.json();

      const delRes = await h.fetch(`/calendar/v3/calendars/primary/events/${event.id}`, { method: 'DELETE' });
      expect(delRes.status).toBe(204);
    });

    it('filters events by timeMin/timeMax', async () => {
      // Add events at different times
      await h.fetch('/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: 'Early Event',
          start: { dateTime: '2026-01-01T10:00:00Z' },
          end: { dateTime: '2026-01-01T11:00:00Z' },
        }),
      });
      await h.fetch('/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: 'Late Event',
          start: { dateTime: '2026-12-01T10:00:00Z' },
          end: { dateTime: '2026-12-01T11:00:00Z' },
        }),
      });

      // Query with timeMin that excludes Early
      const res = await h.fetch('/calendar/v3/calendars/primary/events?timeMin=2026-06-01T00:00:00Z');
      const data = await res.json();
      const summaries = data.items.map((e: any) => e.summary);
      expect(summaries).toContain('Late Event');
      expect(summaries).not.toContain('Early Event');
    });

    it('searches events by q', async () => {
      const res = await h.fetch('/calendar/v3/calendars/primary/events?q=Team');
      const data = await res.json();
      expect(data.items.some((e: any) => e.summary?.includes('Team'))).toBe(true);
    });

    it('creates and lists event via gws roundtrip', async () => {
      // Setup event via control endpoint
      const setup = await h.fetch('/__fws/setup/calendar/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: 'GWS Roundtrip Event',
          start: '2026-05-01T09:00:00Z',
          duration: '1h',
        }),
      });
      const { id } = await setup.json();

      // List via gws
      const { stdout, exitCode } = await h.gws('calendar events list --params {"calendarId":"primary"}');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.items.some((e: any) => e.id === id)).toBe(true);
    });
  });
});
