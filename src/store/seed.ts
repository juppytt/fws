import type { FwsStore, GmailLabel } from './types.js';
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

export function createSeedStore(): FwsStore {
  const labels: Record<string, GmailLabel> = {};
  for (const label of SYSTEM_LABELS) {
    labels[label.id] = { ...label };
  }

  const calendarId = DEFAULT_EMAIL;
  const etag = generateEtag();

  return {
    gmail: {
      profile: {
        emailAddress: DEFAULT_EMAIL,
        messagesTotal: 0,
        threadsTotal: 0,
        historyId: '1000',
      },
      messages: {},
      labels,
      nextHistoryId: 1001,
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
        [calendarId]: {},
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
      files: {},
    },
  };
}

export const DEFAULT_USER_EMAIL = DEFAULT_EMAIL;
