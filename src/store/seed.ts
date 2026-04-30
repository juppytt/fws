import type { FwsStore, GmailLabel, GmailMessage, CalendarEvent, DriveFile, TaskList, Task, Spreadsheet, Person, ContactGroup, GitHubStore, SearchStore, WebFetchStore } from './types.js';
import { generateEtag, generateId } from '../util/id.js';
import { encodeGmailBase64 } from '../util/base64.js';

// Sample IDs for seeded Gmail messages / threads. Generated once per process
// so they look like runtime-created IDs (which use generateId via nanoid)
// instead of structured placeholders like "msg001". Tests that need to
// reference a specific seed entry should import these constants rather than
// hardcoding the old values.
export const SAMPLE_GMAIL_MESSAGE_IDS: readonly string[] = Array.from({ length: 5 }, () => generateId());
export const SAMPLE_GMAIL_THREAD_IDS: readonly string[] = Array.from({ length: 5 }, () => generateId());

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

// Default identity for the seeded mock user. Each can be overridden via
// environment variables at server start so the agent under test sees a
// plausible owner / author / email instead of `testuser` placeholders.
//   FWS_USER_LOGIN     GitHub login (default: testuser)
//   FWS_USER_NAME      Display name used everywhere a "Test User" label was
//                      previously hardcoded (default: Test User)
//   FWS_USER_EMAIL     Gmail / Calendar / Drive owner email + GitHub email
//                      (default: testuser@example.com)
//   FWS_GITHUB_REPO    Default seeded repo. Either a bare name (owner falls
//                      back to FWS_USER_LOGIN) or owner/repo (default:
//                      my-project)
// Snapshots already capture the resolved values via the regular store
// serialization, so a custom identity persists through fws snapshot save/load.
export interface SeedIdentity {
  login: string;
  name: string;
  email: string;
  repoOwner: string;
  repoName: string;
}

export function resolveSeedIdentity(env: NodeJS.ProcessEnv = process.env): SeedIdentity {
  const login = env.FWS_USER_LOGIN || 'testuser';
  const name = env.FWS_USER_NAME || 'Test User';
  const email = env.FWS_USER_EMAIL || 'testuser@example.com';
  const repoSpec = env.FWS_GITHUB_REPO || 'my-project';
  const slash = repoSpec.indexOf('/');
  const repoOwner = slash >= 0 ? repoSpec.slice(0, slash) : login;
  const repoName = slash >= 0 ? repoSpec.slice(slash + 1) : repoSpec;
  return { login, name, email, repoOwner, repoName };
}

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
        // Newer gws +reply / +reply-all / +forward read Message-ID off the
        // source message to populate In-Reply-To / References on the outgoing
        // mail; without it the helper aborts with "Message is missing
        // Message-ID header". (Verified missing-header behavior with gws 0.22.5.)
        { name: 'Message-ID', value: `<${id}@example.com>` },
      ],
      body: {
        size: opts.body.length,
        data: encodeGmailBase64(opts.body),
      },
    },
  };
}

function makeEvent(id: string, email: string, opts: {
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
    creator: { email },
    organizer: { email, self: true },
    etag: generateEtag(),
    htmlLink: `https://calendar.google.com/event?eid=${id}`,
    iCalUID: `${id}@example.com`,
  };
}

function makeFile(id: string, email: string, displayName: string, opts: {
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
    owners: [{ emailAddress: email, displayName }],
  };
}

export function createSeedStore(identity: SeedIdentity = resolveSeedIdentity()): FwsStore {
  const userEmail = identity.email;
  const userDisplayName = identity.name;
  const labels: Record<string, GmailLabel> = {};
  for (const label of SYSTEM_LABELS) {
    labels[label.id] = { ...label };
  }
  labels['Label_projects'] = { id: 'Label_projects', name: 'Projects', type: 'user' };

  const calendarId = userEmail;
  const etag = generateEtag();

  // --- Sample emails ---
  const messages: Record<string, GmailMessage> = {};
  const sampleMessages = [
    makeMessage(SAMPLE_GMAIL_MESSAGE_IDS[0], SAMPLE_GMAIL_THREAD_IDS[0], 1001, {
      from: 'alice@company.com', to: userEmail,
      subject: 'Q3 Planning Meeting',
      body: 'Hi, let\'s meet tomorrow at 2pm to discuss Q3 planning. I\'ve shared the agenda doc in Drive.',
      labels: ['INBOX', 'UNREAD', 'IMPORTANT'], date: '2026-04-07T09:00:00Z',
    }),
    makeMessage(SAMPLE_GMAIL_MESSAGE_IDS[1], SAMPLE_GMAIL_THREAD_IDS[1], 1002, {
      from: 'bob@company.com', to: userEmail,
      subject: 'Code Review: auth refactor PR #42',
      body: 'Please review the auth middleware refactor when you get a chance. The PR is ready.',
      labels: ['INBOX', 'UNREAD'], date: '2026-04-07T10:30:00Z',
    }),
    makeMessage(SAMPLE_GMAIL_MESSAGE_IDS[2], SAMPLE_GMAIL_THREAD_IDS[2], 1003, {
      from: 'notifications@github.com', to: userEmail,
      subject: '[project/repo] CI pipeline failed on main',
      body: 'Build #1234 failed. See details: https://github.com/project/repo/actions/runs/1234',
      labels: ['INBOX', 'UNREAD', 'CATEGORY_UPDATES'], date: '2026-04-07T11:00:00Z',
    }),
    makeMessage(SAMPLE_GMAIL_MESSAGE_IDS[3], SAMPLE_GMAIL_THREAD_IDS[3], 1004, {
      from: userEmail, to: 'alice@company.com',
      subject: 'Re: Project proposal',
      body: 'Looks good to me. Let\'s proceed with option B as discussed.',
      labels: ['SENT'], date: '2026-04-06T16:00:00Z',
    }),
    makeMessage(SAMPLE_GMAIL_MESSAGE_IDS[4], SAMPLE_GMAIL_THREAD_IDS[4], 1005, {
      from: 'hr@company.com', to: userEmail,
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
    makeEvent('evt001', userEmail, {
      summary: 'Daily Standup',
      start: '2026-04-08T09:00:00Z', end: '2026-04-08T09:15:00Z',
    }),
    makeEvent('evt002', userEmail, {
      summary: 'Q3 Planning Meeting',
      start: '2026-04-08T14:00:00Z', end: '2026-04-08T15:00:00Z',
      location: 'Conference Room A',
      description: 'Discuss Q3 roadmap and resource allocation',
    }),
    makeEvent('evt003', userEmail, {
      summary: '1:1 with Manager',
      start: '2026-04-09T10:00:00Z', end: '2026-04-09T10:30:00Z',
    }),
    makeEvent('evt004', userEmail, {
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
    makeFile('file001', userEmail, userDisplayName, { name: 'Q3 Planning Agenda', mimeType: 'application/vnd.google-apps.document' }),
    makeFile('file002', userEmail, userDisplayName, { name: 'Budget 2026.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    makeFile('file003', userEmail, userDisplayName, { name: 'Architecture Diagram.png', mimeType: 'image/png' }),
    makeFile('file004', userEmail, userDisplayName, { name: 'Meeting Notes', mimeType: 'application/vnd.google-apps.document', parents: ['folder001'] }),
    makeFile('folder001', userEmail, userDisplayName, { name: 'Project Docs', mimeType: 'application/vnd.google-apps.folder' }),
  ];
  for (const file of sampleFiles) {
    files[file.id] = file;
  }

  return {
    gmail: {
      profile: {
        emailAddress: userEmail,
        displayName: userDisplayName,
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
          summary: userEmail,
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
          summary: userEmail,
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
    github: createGitHubSeed(identity),
    search: createSearchSeed(),
    webFetch: createWebFetchSeed(),
  };
}

function createWebFetchSeed(): WebFetchStore {
  return {
    // Each fixture's host (or URL host) becomes eligible for proxy
    // interception automatically — no global toggle.
    fixtures: [
      {
        url: 'https://example.com/',
        response: {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          body: '<!doctype html><html><body><h1>Example Domain (mocked)</h1></body></html>',
        },
      },
      {
        host: 'httpbin.org',
        response: {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: 'https://httpbin.org/', origin: '127.0.0.1', mock: true }),
        },
      },
    ],
  };
}

function createSearchSeed(): SearchStore {
  return {
    fixtures: [
      {
        keywords: ['typescript', 'ts'],
        results: [
          {
            title: 'TypeScript: JavaScript With Syntax For Types',
            link: 'https://www.typescriptlang.org/',
            displayLink: 'www.typescriptlang.org',
            snippet: 'TypeScript extends JavaScript by adding types to the language.',
          },
          {
            title: 'TypeScript Documentation',
            link: 'https://www.typescriptlang.org/docs/',
            displayLink: 'www.typescriptlang.org',
            snippet: 'Find TypeScript starter projects: from Angular to React or Node.js and CLIs.',
          },
        ],
      },
      {
        keywords: ['python'],
        results: [
          {
            title: 'Welcome to Python.org',
            link: 'https://www.python.org/',
            displayLink: 'www.python.org',
            snippet: 'The official home of the Python Programming Language.',
          },
        ],
      },
      {
        keywords: ['weather'],
        results: [
          {
            title: 'Weather Forecast - Example.com',
            link: 'https://weather.example.com/',
            displayLink: 'weather.example.com',
            snippet: 'Today: sunny, high 72°F. Tomorrow: partly cloudy.',
          },
        ],
      },
    ],
    defaultResults: [
      {
        title: 'Example Domain',
        link: 'https://example.com/',
        displayLink: 'example.com',
        snippet: 'This domain is for use in illustrative examples in documents.',
      },
    ],
  };
}

function createGitHubSeed(identity: SeedIdentity): GitHubStore {
  const { login, name, email, repoOwner, repoName } = identity;
  const repoFullName = `${repoOwner}/${repoName}`;
  return {
    user: {
      login,
      id: 1,
      name,
      email,
      avatar_url: `https://github.com/${login}.png`,
      html_url: `https://github.com/${login}`,
      type: 'User',
    },
    repos: {
      [repoFullName]: {
        id: 101,
        name: repoName,
        full_name: repoFullName,
        owner: { login: repoOwner, id: 1, type: 'User' },
        private: false,
        html_url: `https://github.com/${repoFullName}`,
        description: 'A sample project for testing',
        fork: false,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-04-07T00:00:00Z',
        pushed_at: '2026-04-07T00:00:00Z',
        default_branch: 'main',
        open_issues_count: 2,
        language: 'TypeScript',
        topics: ['testing', 'mock'],
      },
    },
    issues: {
      [repoFullName]: {
        1: {
          id: 1001,
          number: 1,
          title: 'Fix login bug',
          body: 'Users are getting 401 errors when trying to log in with SSO.',
          state: 'open',
          labels: [{ id: 1, name: 'bug', color: 'd73a4a' }],
          assignees: [{ login, id: 1 }],
          user: { login: 'alice', id: 2 },
          created_at: '2026-04-05T10:00:00Z',
          updated_at: '2026-04-06T14:00:00Z',
          closed_at: null,
          html_url: `https://github.com/${repoFullName}/issues/1`,
          comments: 1,
        },
        2: {
          id: 1002,
          number: 2,
          title: 'Add dark mode support',
          body: 'It would be great to have a dark mode option.',
          state: 'open',
          labels: [{ id: 2, name: 'enhancement', color: 'a2eeef' }],
          assignees: [],
          user: { login: 'bob', id: 3 },
          created_at: '2026-04-06T09:00:00Z',
          updated_at: '2026-04-06T09:00:00Z',
          closed_at: null,
          html_url: `https://github.com/${repoFullName}/issues/2`,
          comments: 0,
        },
      },
    },
    pulls: {
      [repoFullName]: {
        3: {
          id: 2001,
          number: 3,
          title: 'Fix SSO login flow',
          body: 'Fixes #1. Updated the auth middleware to handle SSO tokens correctly.',
          state: 'open',
          head: { ref: 'fix/sso-login', sha: 'abc1234', label: `${login}:fix/sso-login` },
          base: { ref: 'main', sha: 'def5678', label: `${login}:main` },
          user: { login, id: 1 },
          created_at: '2026-04-07T08:00:00Z',
          updated_at: '2026-04-07T08:00:00Z',
          merged_at: null,
          closed_at: null,
          html_url: `https://github.com/${repoFullName}/pull/3`,
          mergeable: true,
          draft: false,
        },
      },
    },
    comments: {
      [`${repoFullName}/issues/1`]: [
        {
          id: 3001,
          body: 'I can reproduce this. Happens with Google SSO specifically.',
          user: { login: 'bob', id: 3 },
          created_at: '2026-04-06T14:00:00Z',
          updated_at: '2026-04-06T14:00:00Z',
          html_url: `https://github.com/${repoFullName}/issues/1#issuecomment-3001`,
        },
      ],
    },
  };
}
