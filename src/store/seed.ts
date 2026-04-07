import type { FwsStore, GmailLabel, GmailMessage, CalendarEvent, DriveFile, TaskList, Task, Spreadsheet, Person, ContactGroup } from './types.js';
import { generateEtag } from '../util/id.js';

const SYSTEM_LABELS: GmailLabel[] = [
  { id: 'INBOX', name: 'INBOX', type: 'system' },
  { id: 'SENT', name: 'SENT', type: 'system' },
  { id: 'DRAFT', name: 'DRAFT', type: 'system' },
  { id: 'TRASH', name: 'TRASH', type: 'system' },
  { id: 'SPAM', name: 'SPAM', type: 'system' },
  { id: 'STARRED', name: 'STARRED', type: 'system' },
  { id: 'UNREAD', name: 'UNREAD', type: 'system' },
  { id: 'IMPORTANT', name: 'IMPORTANT', type: 'system' },
  { id: 'CATEGORY_PERSONAL', name: 'CATEGORY_PERSONAL', type: 'system' },
  { id: 'CATEGORY_SOCIAL', name: 'CATEGORY_SOCIAL', type: 'system' },
  { id: 'CATEGORY_PROMOTIONS', name: 'CATEGORY_PROMOTIONS', type: 'system' },
  { id: 'CATEGORY_UPDATES', name: 'CATEGORY_UPDATES', type: 'system' },
  { id: 'CATEGORY_FORUMS', name: 'CATEGORY_FORUMS', type: 'system' },
];

const DEFAULT_EMAIL = 'testuser@example.com';

function makeMessage(id: string, threadId: string, historyId: number, opts: {
  from: string; to: string; subject: string; body: string;
  labels: string[]; date: string;
}): GmailMessage {
  return {
    id,
    threadId,
    labelIds: opts.labels,
    snippet: opts.body.slice(0, 100),
    historyId: String(historyId),
    internalDate: String(new Date(opts.date).getTime()),
    sizeEstimate: opts.body.length,
    payload: {
      partId: '',
      mimeType: 'text/plain',
      filename: '',
      headers: [
        { name: 'From', value: opts.from },
        { name: 'To', value: opts.to },
        { name: 'Subject', value: opts.subject },
        { name: 'Date', value: opts.date },
      ],
      body: {
        size: opts.body.length,
        data: Buffer.from(opts.body).toString('base64url'),
      },
    },
  };
}

function makeEvent(id: string, opts: {
  summary: string; start: string; end: string;
  description?: string; location?: string;
}): CalendarEvent {
  return {
    kind: 'calendar#event',
    id,
    status: 'confirmed',
    summary: opts.summary,
    description: opts.description,
    location: opts.location,
    start: { dateTime: opts.start },
    end: { dateTime: opts.end },
    created: '2026-04-01T00:00:00Z',
    updated: '2026-04-01T00:00:00Z',
    creator: { email: DEFAULT_EMAIL },
    organizer: { email: DEFAULT_EMAIL, self: true },
    etag: generateEtag(),
    htmlLink: `https://calendar.google.com/event?eid=${id}`,
    iCalUID: `${id}@example.com`,
  };
}

function makeFile(id: string, opts: {
  name: string; mimeType: string; parents?: string[];
}): DriveFile {
  return {
    kind: 'drive#file',
    id,
    name: opts.name,
    mimeType: opts.mimeType,
    parents: opts.parents || ['root'],
    createdTime: '2026-04-01T00:00:00Z',
    modifiedTime: '2026-04-01T00:00:00Z',
    trashed: false,
    starred: false,
    owners: [{ emailAddress: DEFAULT_EMAIL, displayName: 'Test User' }],
  };
}

export function createSeedStore(): FwsStore {
  const labels: Record<string, GmailLabel> = {};
  for (const label of SYSTEM_LABELS) {
    labels[label.id] = { ...label };
  }
  labels['Label_projects'] = { id: 'Label_projects', name: 'Projects', type: 'user' };

  const calendarId = DEFAULT_EMAIL;
  const etag = generateEtag();

  // --- Sample emails ---
  const messages: Record<string, GmailMessage> = {};
  const sampleMessages = [
    makeMessage('msg001', 'thread001', 1001, {
      from: 'alice@company.com', to: DEFAULT_EMAIL,
      subject: 'Q3 Planning Meeting',
      body: 'Hi, let\'s meet tomorrow at 2pm to discuss Q3 planning. I\'ve shared the agenda doc in Drive.',
      labels: ['INBOX', 'UNREAD', 'IMPORTANT'], date: '2026-04-07T09:00:00Z',
    }),
    makeMessage('msg002', 'thread002', 1002, {
      from: 'bob@company.com', to: DEFAULT_EMAIL,
      subject: 'Code Review: auth refactor PR #42',
      body: 'Please review the auth middleware refactor when you get a chance. The PR is ready.',
      labels: ['INBOX', 'UNREAD'], date: '2026-04-07T10:30:00Z',
    }),
    makeMessage('msg003', 'thread003', 1003, {
      from: 'notifications@github.com', to: DEFAULT_EMAIL,
      subject: '[project/repo] CI pipeline failed on main',
      body: 'Build #1234 failed. See details: https://github.com/project/repo/actions/runs/1234',
      labels: ['INBOX', 'UNREAD', 'CATEGORY_UPDATES'], date: '2026-04-07T11:00:00Z',
    }),
    makeMessage('msg004', 'thread004', 1004, {
      from: DEFAULT_EMAIL, to: 'alice@company.com',
      subject: 'Re: Project proposal',
      body: 'Looks good to me. Let\'s proceed with option B as discussed.',
      labels: ['SENT'], date: '2026-04-06T16:00:00Z',
    }),
    makeMessage('msg005', 'thread005', 1005, {
      from: 'hr@company.com', to: DEFAULT_EMAIL,
      subject: 'Reminder: Submit timesheet by Friday',
      body: 'Please submit your timesheet for this week by end of day Friday.',
      labels: ['INBOX'], date: '2026-04-05T08:00:00Z',
    }),
  ];
  for (const msg of sampleMessages) {
    messages[msg.id] = msg;
  }

  // --- Sample events ---
  const events: Record<string, CalendarEvent> = {};
  const sampleEvents = [
    makeEvent('evt001', {
      summary: 'Daily Standup',
      start: '2026-04-08T09:00:00Z', end: '2026-04-08T09:15:00Z',
    }),
    makeEvent('evt002', {
      summary: 'Q3 Planning Meeting',
      start: '2026-04-08T14:00:00Z', end: '2026-04-08T15:00:00Z',
      location: 'Conference Room A',
      description: 'Discuss Q3 roadmap and resource allocation',
    }),
    makeEvent('evt003', {
      summary: '1:1 with Manager',
      start: '2026-04-09T10:00:00Z', end: '2026-04-09T10:30:00Z',
    }),
    makeEvent('evt004', {
      summary: 'Team Lunch',
      start: '2026-04-10T12:00:00Z', end: '2026-04-10T13:00:00Z',
      location: 'Cafeteria',
    }),
  ];
  for (const evt of sampleEvents) {
    events[evt.id] = evt;
  }

  // --- Sample drive files ---
  const files: Record<string, DriveFile> = {};
  const sampleFiles = [
    makeFile('file001', { name: 'Q3 Planning Agenda', mimeType: 'application/vnd.google-apps.document' }),
    makeFile('file002', { name: 'Budget 2026.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    makeFile('file003', { name: 'Architecture Diagram.png', mimeType: 'image/png' }),
    makeFile('file004', { name: 'Meeting Notes', mimeType: 'application/vnd.google-apps.document', parents: ['folder001'] }),
    makeFile('folder001', { name: 'Project Docs', mimeType: 'application/vnd.google-apps.folder' }),
  ];
  for (const file of sampleFiles) {
    files[file.id] = file;
  }

  return {
    gmail: {
      profile: {
        emailAddress: DEFAULT_EMAIL,
        messagesTotal: sampleMessages.length,
        threadsTotal: sampleMessages.length,
        historyId: '1005',
      },
      messages,
      labels,
      nextHistoryId: 1006,
    },
    calendar: {
      calendars: {
        [calendarId]: {
          kind: 'calendar#calendar',
          id: calendarId,
          summary: DEFAULT_EMAIL,
          timeZone: 'UTC',
          etag,
        },
      },
      events: {
        [calendarId]: events,
      },
      calendarList: {
        [calendarId]: {
          kind: 'calendar#calendarListEntry',
          id: calendarId,
          summary: DEFAULT_EMAIL,
          timeZone: 'UTC',
          accessRole: 'owner',
          defaultReminders: [],
          selected: true,
          primary: true,
          etag,
        },
      },
    },
    drive: {
      files,
    },
    tasks: {
      taskLists: {
        'default': {
          kind: 'tasks#taskList',
          id: 'default',
          title: 'My Tasks',
          updated: '2026-04-01T00:00:00Z',
          selfLink: '',
        },
      },
      tasks: {
        'default': {
          'task001': {
            kind: 'tasks#task',
            id: 'task001',
            title: 'Review Q3 proposal',
            updated: '2026-04-07T09:00:00Z',
            selfLink: '',
            status: 'needsAction',
            due: '2026-04-10T00:00:00Z',
            notes: 'Check budget section',
            position: '00000000000000000001',
          },
          'task002': {
            kind: 'tasks#task',
            id: 'task002',
            title: 'Update documentation',
            updated: '2026-04-06T14:00:00Z',
            selfLink: '',
            status: 'completed',
            completed: '2026-04-06T16:00:00Z',
            position: '00000000000000000002',
          },
        },
      },
    },
    sheets: {
      spreadsheets: {
        'sheet001': {
          spreadsheetId: 'sheet001',
          properties: {
            title: 'Budget 2026',
            locale: 'en_US',
            timeZone: 'America/New_York',
          },
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                index: 0,
                sheetType: 'GRID',
                gridProperties: { rowCount: 100, columnCount: 26 },
              },
            },
          ],
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet001/edit',
        },
      },
    },
    people: {
      contacts: {
        'people/c001': {
          resourceName: 'people/c001',
          etag: generateEtag(),
          names: [{ displayName: 'Alice Johnson', givenName: 'Alice', familyName: 'Johnson' }],
          emailAddresses: [{ value: 'alice@company.com', type: 'work' }],
          phoneNumbers: [{ value: '+1-555-0101', type: 'work' }],
          organizations: [{ name: 'Company Inc', title: 'Engineer' }],
        },
        'people/c002': {
          resourceName: 'people/c002',
          etag: generateEtag(),
          names: [{ displayName: 'Bob Smith', givenName: 'Bob', familyName: 'Smith' }],
          emailAddresses: [{ value: 'bob@company.com', type: 'work' }],
        },
      },
      contactGroups: {
        'contactGroups/myContacts': {
          resourceName: 'contactGroups/myContacts',
          etag: generateEtag(),
          name: 'My Contacts',
          groupType: 'SYSTEM_CONTACT_GROUP',
          memberCount: 2,
          memberResourceNames: ['people/c001', 'people/c002'],
        },
      },
    },
  };
}

export const DEFAULT_USER_EMAIL = DEFAULT_EMAIL;
