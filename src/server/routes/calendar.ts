import { Router } from 'express';
import { getStore } from '../../store/index.js';
import { generateId, generateEtag } from '../../util/id.js';

export function calendarRoutes(): Router {
  const r = Router();
  const PREFIX = '/calendar/v3';

  function resolveCalendarId(raw: string): string {
    if (raw === 'primary') {
      const store = getStore();
      const primary = Object.values(store.calendar.calendarList).find(c => c.primary);
      return primary?.id || Object.keys(store.calendar.calendars)[0] || raw;
    }
    return raw;
  }

  // LIST calendarList
  r.get(`${PREFIX}/users/me/calendarList`, (_req, res) => {
    const items = Object.values(getStore().calendar.calendarList);
    res.json({ kind: 'calendar#calendarList', etag: generateEtag(), items });
  });

  // GET calendarList entry
  r.get(`${PREFIX}/users/me/calendarList/:calendarId`, (req, res) => {
    const id = resolveCalendarId(req.params.calendarId);
    const entry = getStore().calendar.calendarList[id];
    if (!entry) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }
    res.json(entry);
  });

  // INSERT calendarList entry
  r.post(`${PREFIX}/users/me/calendarList`, (req, res) => {
    const store = getStore();
    const id = req.body.id;
    if (!id || !store.calendar.calendars[id]) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }
    const cal = store.calendar.calendars[id];
    const etag = generateEtag();
    store.calendar.calendarList[id] = {
      kind: 'calendar#calendarListEntry',
      id,
      summary: cal.summary,
      description: cal.description,
      timeZone: cal.timeZone,
      accessRole: req.body.accessRole || 'reader',
      defaultReminders: req.body.defaultReminders || [],
      selected: req.body.selected ?? true,
      etag,
    };
    res.json(store.calendar.calendarList[id]);
  });

  // PATCH calendarList entry
  r.patch(`${PREFIX}/users/me/calendarList/:calendarId`, (req, res) => {
    const id = resolveCalendarId(req.params.calendarId);
    const store = getStore();
    const entry = store.calendar.calendarList[id];
    if (!entry) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }
    Object.assign(entry, req.body, { id, kind: entry.kind });
    entry.etag = generateEtag();
    res.json(entry);
  });

  // UPDATE calendarList entry (PUT)
  r.put(`${PREFIX}/users/me/calendarList/:calendarId`, (req, res) => {
    const id = resolveCalendarId(req.params.calendarId);
    const store = getStore();
    if (!store.calendar.calendarList[id]) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }
    store.calendar.calendarList[id] = {
      kind: 'calendar#calendarListEntry',
      ...req.body,
      id,
      etag: generateEtag(),
    };
    res.json(store.calendar.calendarList[id]);
  });

  // DELETE calendarList entry
  r.delete(`${PREFIX}/users/me/calendarList/:calendarId`, (req, res) => {
    const id = resolveCalendarId(req.params.calendarId);
    const store = getStore();
    if (!store.calendar.calendarList[id]) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }
    delete store.calendar.calendarList[id];
    res.status(204).send();
  });

  // CREATE calendar
  r.post(`${PREFIX}/calendars`, (req, res) => {
    const store = getStore();
    const id = generateId();
    const etag = generateEtag();
    const cal = {
      kind: 'calendar#calendar' as const,
      id,
      summary: req.body.summary || 'Untitled',
      description: req.body.description,
      timeZone: req.body.timeZone || 'UTC',
      etag,
    };
    store.calendar.calendars[id] = cal;
    store.calendar.events[id] = {};
    store.calendar.calendarList[id] = {
      kind: 'calendar#calendarListEntry',
      id,
      summary: cal.summary,
      description: cal.description,
      timeZone: cal.timeZone,
      accessRole: 'owner',
      defaultReminders: [],
      selected: true,
      etag,
    };
    res.json(cal);
  });

  // GET calendar
  r.get(`${PREFIX}/calendars/:calendarId`, (req, res) => {
    const id = resolveCalendarId(req.params.calendarId);
    const cal = getStore().calendar.calendars[id];
    if (!cal) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }
    res.json(cal);
  });

  // PATCH calendar
  r.patch(`${PREFIX}/calendars/:calendarId`, (req, res) => {
    const id = resolveCalendarId(req.params.calendarId);
    const store = getStore();
    const cal = store.calendar.calendars[id];
    if (!cal) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }
    Object.assign(cal, req.body, { id, kind: cal.kind });
    cal.etag = generateEtag();
    // Also update calendarList entry
    const listEntry = store.calendar.calendarList[id];
    if (listEntry) {
      if (req.body.summary) listEntry.summary = req.body.summary;
      if (req.body.description) listEntry.description = req.body.description;
      listEntry.etag = cal.etag;
    }
    res.json(cal);
  });

  // UPDATE calendar (PUT)
  r.put(`${PREFIX}/calendars/:calendarId`, (req, res) => {
    const id = resolveCalendarId(req.params.calendarId);
    const store = getStore();
    if (!store.calendar.calendars[id]) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }
    const etag = generateEtag();
    store.calendar.calendars[id] = {
      kind: 'calendar#calendar',
      ...req.body,
      id,
      etag,
    };
    const listEntry = store.calendar.calendarList[id];
    if (listEntry) {
      listEntry.summary = req.body.summary || listEntry.summary;
      listEntry.description = req.body.description;
      listEntry.timeZone = req.body.timeZone || listEntry.timeZone;
      listEntry.etag = etag;
    }
    res.json(store.calendar.calendars[id]);
  });

  // CLEAR calendar (delete all events)
  r.post(`${PREFIX}/calendars/:calendarId/clear`, (req, res) => {
    const id = resolveCalendarId(req.params.calendarId);
    const store = getStore();
    if (!store.calendar.events[id]) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }
    store.calendar.events[id] = {};
    res.status(204).send();
  });

  // DELETE calendar
  r.delete(`${PREFIX}/calendars/:calendarId`, (req, res) => {
    const id = resolveCalendarId(req.params.calendarId);
    const store = getStore();
    if (!store.calendar.calendars[id]) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }
    delete store.calendar.calendars[id];
    delete store.calendar.events[id];
    delete store.calendar.calendarList[id];
    res.status(204).send();
  });

  // LIST events
  r.get(`${PREFIX}/calendars/:calendarId/events`, (req, res) => {
    const id = resolveCalendarId(req.params.calendarId);
    const store = getStore();
    const eventsMap = store.calendar.events[id];
    if (!eventsMap) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }

    let events = Object.values(eventsMap);

    // Filter cancelled unless showDeleted
    if (req.query.showDeleted !== 'true') {
      events = events.filter(e => e.status !== 'cancelled');
    }

    // Time range filtering
    const timeMin = req.query.timeMin as string | undefined;
    const timeMax = req.query.timeMax as string | undefined;
    if (timeMin) {
      const min = new Date(timeMin).getTime();
      events = events.filter(e => {
        const end = new Date(e.end.dateTime || e.end.date || '').getTime();
        return end > min;
      });
    }
    if (timeMax) {
      const max = new Date(timeMax).getTime();
      events = events.filter(e => {
        const start = new Date(e.start.dateTime || e.start.date || '').getTime();
        return start < max;
      });
    }

    // Search by q
    const q = req.query.q as string | undefined;
    if (q) {
      const lower = q.toLowerCase();
      events = events.filter(e =>
        (e.summary || '').toLowerCase().includes(lower) ||
        (e.description || '').toLowerCase().includes(lower)
      );
    }

    // Sort by start time
    events.sort((a, b) => {
      const aTime = new Date(a.start.dateTime || a.start.date || '').getTime();
      const bTime = new Date(b.start.dateTime || b.start.date || '').getTime();
      return aTime - bTime;
    });

    const maxResults = parseInt(req.query.maxResults as string) || 250;
    events = events.slice(0, maxResults);

    res.json({
      kind: 'calendar#events',
      summary: store.calendar.calendars[id]?.summary || '',
      updated: new Date().toISOString(),
      items: events,
    });
  });

  // CREATE event
  r.post(`${PREFIX}/calendars/:calendarId/events`, (req, res) => {
    const calId = resolveCalendarId(req.params.calendarId);
    const store = getStore();
    if (!store.calendar.events[calId]) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }

    const eventId = generateId();
    const now = new Date().toISOString();
    const userEmail = store.gmail.profile.emailAddress;

    const event = {
      kind: 'calendar#event' as const,
      id: eventId,
      status: (req.body.status || 'confirmed') as 'confirmed',
      summary: req.body.summary,
      description: req.body.description,
      location: req.body.location,
      start: req.body.start || { dateTime: now },
      end: req.body.end || { dateTime: now },
      created: now,
      updated: now,
      creator: { email: userEmail },
      organizer: { email: userEmail, self: true },
      attendees: req.body.attendees,
      etag: generateEtag(),
      htmlLink: `https://calendar.google.com/event?eid=${eventId}`,
      iCalUID: `${eventId}@example.com`,
    };

    store.calendar.events[calId][eventId] = event;
    res.json(event);
  });

  // GET event
  r.get(`${PREFIX}/calendars/:calendarId/events/:eventId`, (req, res) => {
    const calId = resolveCalendarId(req.params.calendarId);
    const event = getStore().calendar.events[calId]?.[req.params.eventId];
    if (!event) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }
    res.json(event);
  });

  // PATCH event
  r.patch(`${PREFIX}/calendars/:calendarId/events/:eventId`, (req, res) => {
    const calId = resolveCalendarId(req.params.calendarId);
    const store = getStore();
    const event = store.calendar.events[calId]?.[req.params.eventId];
    if (!event) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }
    Object.assign(event, req.body, { id: event.id, kind: event.kind });
    event.updated = new Date().toISOString();
    event.etag = generateEtag();
    res.json(event);
  });

  // PUT event (full replace)
  r.put(`${PREFIX}/calendars/:calendarId/events/:eventId`, (req, res) => {
    const calId = resolveCalendarId(req.params.calendarId);
    const store = getStore();
    if (!store.calendar.events[calId]?.[req.params.eventId]) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }
    const userEmail = store.gmail.profile.emailAddress;
    const event = {
      kind: 'calendar#event' as const,
      ...req.body,
      id: req.params.eventId,
      updated: new Date().toISOString(),
      creator: req.body.creator || { email: userEmail },
      organizer: req.body.organizer || { email: userEmail, self: true },
      etag: generateEtag(),
      htmlLink: `https://calendar.google.com/event?eid=${req.params.eventId}`,
      iCalUID: req.body.iCalUID || `${req.params.eventId}@example.com`,
    };
    store.calendar.events[calId][req.params.eventId] = event;
    res.json(event);
  });

  // DELETE event
  r.delete(`${PREFIX}/calendars/:calendarId/events/:eventId`, (req, res) => {
    const calId = resolveCalendarId(req.params.calendarId);
    const store = getStore();
    if (!store.calendar.events[calId]?.[req.params.eventId]) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }
    delete store.calendar.events[calId][req.params.eventId];
    res.status(204).send();
  });

  // IMPORT event (like insert but preserves iCalUID)
  r.post(`${PREFIX}/calendars/:calendarId/events/import`, (req, res) => {
    const calId = resolveCalendarId(req.params.calendarId);
    const store = getStore();
    if (!store.calendar.events[calId]) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }
    const eventId = generateId();
    const now = new Date().toISOString();
    const userEmail = store.gmail.profile.emailAddress;
    const event = {
      kind: 'calendar#event' as const,
      ...req.body,
      id: eventId,
      status: req.body.status || 'confirmed',
      created: now,
      updated: now,
      creator: req.body.creator || { email: userEmail },
      organizer: req.body.organizer || { email: userEmail, self: true },
      etag: generateEtag(),
      htmlLink: `https://calendar.google.com/event?eid=${eventId}`,
      iCalUID: req.body.iCalUID || `${eventId}@example.com`,
    };
    store.calendar.events[calId][eventId] = event;
    res.json(event);
  });

  // MOVE event to another calendar
  r.post(`${PREFIX}/calendars/:calendarId/events/:eventId/move`, (req, res) => {
    const srcCalId = resolveCalendarId(req.params.calendarId);
    const destCalId = resolveCalendarId(req.query.destination as string);
    const store = getStore();
    const event = store.calendar.events[srcCalId]?.[req.params.eventId];
    if (!event) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }
    if (!store.calendar.events[destCalId]) {
      return res.status(404).json({
        error: { code: 404, message: 'Destination calendar not found', status: 'NOT_FOUND' },
      });
    }
    // Move: delete from source, add to destination
    delete store.calendar.events[srcCalId][req.params.eventId];
    store.calendar.events[destCalId][req.params.eventId] = event;
    event.updated = new Date().toISOString();
    event.etag = generateEtag();
    res.json(event);
  });

  // QUICK ADD event (from text)
  r.post(`${PREFIX}/calendars/:calendarId/events/quickAdd`, (req, res) => {
    const calId = resolveCalendarId(req.params.calendarId);
    const store = getStore();
    if (!store.calendar.events[calId]) {
      return res.status(404).json({
        error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' },
      });
    }
    const text = req.query.text as string || '';
    const eventId = generateId();
    const now = new Date().toISOString();
    const userEmail = store.gmail.profile.emailAddress;

    // Simple parsing: use the text as summary, default to 1h from now
    const start = new Date();
    const end = new Date(start.getTime() + 3600000);

    const event = {
      kind: 'calendar#event' as const,
      id: eventId,
      status: 'confirmed' as const,
      summary: text,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      created: now,
      updated: now,
      creator: { email: userEmail },
      organizer: { email: userEmail, self: true },
      etag: generateEtag(),
      htmlLink: `https://calendar.google.com/event?eid=${eventId}`,
      iCalUID: `${eventId}@example.com`,
    };
    store.calendar.events[calId][eventId] = event;
    res.json(event);
  });

  return r;
}
