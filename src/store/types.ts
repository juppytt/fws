// === Top-level store ===

export interface FwsStore {
  gmail: GmailStore;
  calendar: CalendarStore;
  drive: DriveStore;
}

// === Gmail ===

export interface GmailStore {
  profile: GmailProfile;
  messages: Record<string, GmailMessage>;
  labels: Record<string, GmailLabel>;
  nextHistoryId: number;
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId: string;
  internalDate: string;
  sizeEstimate: number;
  raw?: string;
  payload: GmailMessagePart;
}

export interface GmailMessagePart {
  partId: string;
  mimeType: string;
  filename: string;
  headers: Array<{ name: string; value: string }>;
  body: { attachmentId?: string; size: number; data?: string };
  parts?: GmailMessagePart[];
}

export interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
  color?: { textColor: string; backgroundColor: string };
}

// === Calendar ===

export interface CalendarStore {
  calendars: Record<string, CalendarEntry>;
  events: Record<string, Record<string, CalendarEvent>>;
  calendarList: Record<string, CalendarListEntry>;
}

export interface CalendarEntry {
  kind: 'calendar#calendar';
  id: string;
  summary: string;
  description?: string;
  timeZone?: string;
  etag: string;
}

export interface CalendarListEntry {
  kind: 'calendar#calendarListEntry';
  id: string;
  summary: string;
  description?: string;
  timeZone?: string;
  accessRole: string;
  defaultReminders: unknown[];
  selected?: boolean;
  primary?: boolean;
  etag: string;
}

export interface CalendarEvent {
  kind: 'calendar#event';
  id: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  created: string;
  updated: string;
  creator: { email: string };
  organizer: { email: string; self?: boolean };
  attendees?: Array<{ email: string; responseStatus: string }>;
  etag: string;
  htmlLink: string;
  iCalUID: string;
}

// === Drive ===

export interface DriveStore {
  files: Record<string, DriveFile>;
}

export interface DriveFile {
  kind: 'drive#file';
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  createdTime: string;
  modifiedTime: string;
  size?: string;
  trashed: boolean;
  starred: boolean;
  owners?: Array<{ emailAddress: string; displayName: string }>;
  webViewLink?: string;
  description?: string;
}
