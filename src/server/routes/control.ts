import { Router } from 'express';
import { getStore, resetStore, loadStore, serializeStore } from '../../store/index.js';
import { generateId, generateEtag } from '../../util/id.js';
import { encodeGmailBase64 } from '../../util/base64.js';
import { setupGitRepo } from './git-http.js';

export function controlRoutes(): Router {
  const r = Router();

  r.get('/__fws/status', (_req, res) => {
    res.json({ status: 'ok' });
  });

  r.post('/__fws/snapshot/save', (_req, res) => {
    const json = serializeStore();
    res.type('application/json').send(json);
  });

  r.post('/__fws/snapshot/load', (req, res) => {
    const data = req.body;
    loadStore(data);
    res.json({ status: 'loaded' });
  });

  r.post('/__fws/reset', (_req, res) => {
    resetStore();
    res.json({ status: 'reset' });
  });

  // Setup convenience endpoints
  r.post('/__fws/setup/gmail/message', (req, res) => {
    const store = getStore();
    const { from, to, subject, body, labels, date } = req.body;
    const id = generateId();
    const threadId = generateId();
    const now = date || new Date().toISOString();
    const internalDate = String(new Date(now).getTime());
    const snippet = (body || '').slice(0, 100);
    const msgLabels = labels || ['INBOX', 'UNREAD'];
    const userEmail = store.gmail.profile.emailAddress;

    store.gmail.messages[id] = {
      id,
      threadId,
      labelIds: msgLabels,
      snippet,
      historyId: String(store.gmail.nextHistoryId++),
      internalDate,
      sizeEstimate: (body || '').length,
      payload: {
        partId: '',
        mimeType: 'text/plain',
        filename: '',
        headers: [
          { name: 'From', value: from || 'unknown@example.com' },
          { name: 'To', value: to || userEmail },
          { name: 'Subject', value: subject || '(no subject)' },
          { name: 'Date', value: now },
          { name: 'Message-ID', value: `<${id}@example.com>` },
        ],
        body: {
          size: (body || '').length,
          data: encodeGmailBase64(body || ''),
        },
      },
    };
    store.gmail.profile.messagesTotal++;
    store.gmail.profile.threadsTotal++;

    res.json({ id, threadId });
  });

  r.post('/__fws/setup/calendar/event', (req, res) => {
    const store = getStore();
    const { summary, description, location, start, duration, calendar, attendees } = req.body;
    const calendarId = calendar || Object.keys(store.calendar.calendars)[0];
    if (!store.calendar.events[calendarId]) {
      store.calendar.events[calendarId] = {};
    }

    const id = generateId();
    const now = new Date().toISOString();
    const startDate = new Date(start);
    const durationMs = parseDuration(duration || '1h');
    const endDate = new Date(startDate.getTime() + durationMs);
    const userEmail = store.gmail.profile.emailAddress;

    const event = {
      kind: 'calendar#event' as const,
      id,
      status: 'confirmed' as const,
      summary: summary || '(no title)',
      description,
      location,
      start: { dateTime: startDate.toISOString() },
      end: { dateTime: endDate.toISOString() },
      created: now,
      updated: now,
      creator: { email: userEmail },
      organizer: { email: userEmail, self: true },
      attendees: attendees
        ? attendees.map((email: string) => ({ email, responseStatus: 'needsAction' }))
        : undefined,
      etag: generateEtag(),
      htmlLink: `https://calendar.google.com/event?eid=${id}`,
      iCalUID: `${id}@example.com`,
    };

    store.calendar.events[calendarId][id] = event;
    res.json({ id, calendarId });
  });

  r.post('/__fws/setup/drive/file', (req, res) => {
    const store = getStore();
    const { name, mimeType, parent, size, description } = req.body;
    const id = generateId();
    const now = new Date().toISOString();
    const userEmail = store.gmail.profile.emailAddress;

    store.drive.files[id] = {
      kind: 'drive#file',
      id,
      name: name || 'Untitled',
      mimeType: mimeType || 'application/octet-stream',
      parents: parent ? [parent] : ['root'],
      createdTime: now,
      modifiedTime: now,
      size: size ? String(size) : undefined,
      trashed: false,
      starred: false,
      owners: [{ emailAddress: userEmail, displayName: store.gmail.profile.displayName }],
      description,
    };

    res.json({ id });
  });

  // Clear only web fetch fixtures (preserves gmail/calendar/drive/etc.)
  r.post('/__fws/setup/fetch/reset', (_req, res) => {
    const store = getStore();
    store.webFetch.fixtures = [];
    res.json({ status: 'reset', scope: 'webFetch' });
  });

  // Mutate the seeded "self" user. Lets an operator alternate authors at
  // runtime — `fws github user set --login alex.park`, then a `gh issue
  // create` is stamped with alex.park as user.login; switch again to
  // david.kim before the next create. Only fields included in the body
  // are touched, so partial updates work.
  r.post('/__fws/setup/github/user', (req, res) => {
    const body = req.body ?? {};
    if (body.login !== undefined && typeof body.login !== 'string') {
      return res.status(400).json({ error: 'login must be a string' });
    }
    if (body.name !== undefined && typeof body.name !== 'string') {
      return res.status(400).json({ error: 'name must be a string' });
    }
    if (body.email !== undefined && typeof body.email !== 'string') {
      return res.status(400).json({ error: 'email must be a string' });
    }
    const store = getStore();
    if (typeof body.login === 'string') {
      store.github.user.login = body.login;
      store.github.user.avatar_url = `https://github.com/${body.login}.png`;
      store.github.user.html_url = `https://github.com/${body.login}`;
    }
    if (typeof body.name === 'string') {
      store.github.user.name = body.name;
      // Display name is shared with Drive owners / Gmail sendAs, which
      // read store.gmail.profile.displayName at request time.
      store.gmail.profile.displayName = body.name;
    }
    if (typeof body.email === 'string') {
      store.github.user.email = body.email;
    }
    res.json({
      login: store.github.user.login,
      name: store.github.user.name,
      email: store.github.user.email,
    });
  });

  // Create (or overwrite) a mock GitHub repo that clients can `git clone`.
  //   POST /__fws/setup/github/repo  { owner, repo, files?, defaultBranch?, ... }
  // Bare repo is materialized on disk so fws can delegate the clone protocol
  // to `git upload-pack`; see routes/git-http.ts.
  r.post('/__fws/setup/github/repo', async (req, res, next) => {
    try {
      const body = req.body ?? {};
      if (typeof body.owner !== 'string' || typeof body.repo !== 'string') {
        return res.status(400).json({ error: 'owner and repo are required strings' });
      }
      const out = await setupGitRepo({
        owner: body.owner,
        repo: body.repo,
        files: Array.isArray(body.files) ? body.files : undefined,
        defaultBranch: typeof body.defaultBranch === 'string' ? body.defaultBranch : undefined,
        commitMessage: typeof body.commitMessage === 'string' ? body.commitMessage : undefined,
        authorName: typeof body.authorName === 'string' ? body.authorName : undefined,
        authorEmail: typeof body.authorEmail === 'string' ? body.authorEmail : undefined,
      });
      res.json({ status: 'ok', ...out });
    } catch (err) {
      next(err);
    }
  });

  return r;
}

function parseDuration(d: string): number {
  const match = d.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) return 3600000; // default 1h
  const val = parseInt(match[1]);
  const unit = match[2];
  switch (unit) {
    case 'ms': return val;
    case 's': return val * 1000;
    case 'm': return val * 60000;
    case 'h': return val * 3600000;
    case 'd': return val * 86400000;
    default: return 3600000;
  }
}
