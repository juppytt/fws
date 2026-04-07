// === Top-level store ===

export interface FwsStore {
  gmail: GmailStore;
  calendar: CalendarStore;
  drive: DriveStore;
  tasks: TasksStore;
  sheets: SheetsStore;
  people: PeopleStore;
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

// === Tasks ===

export interface TasksStore {
  taskLists: Record<string, TaskList>;
  tasks: Record<string, Record<string, Task>>; // taskListId -> taskId -> task
}

export interface TaskList {
  kind: 'tasks#taskList';
  id: string;
  title: string;
  updated: string;
  selfLink: string;
}

export interface Task {
  kind: 'tasks#task';
  id: string;
  title: string;
  updated: string;
  selfLink: string;
  status: 'needsAction' | 'completed';
  due?: string;
  notes?: string;
  completed?: string;
  parent?: string;
  position: string;
  links?: Array<{ type: string; description: string; link: string }>;
}

// === Sheets ===

export interface SheetsStore {
  spreadsheets: Record<string, Spreadsheet>;
}

export interface Spreadsheet {
  spreadsheetId: string;
  properties: {
    title: string;
    locale?: string;
    autoRecalc?: string;
    timeZone?: string;
  };
  sheets: Sheet[];
  spreadsheetUrl: string;
}

export interface Sheet {
  properties: {
    sheetId: number;
    title: string;
    index: number;
    sheetType: string;
    gridProperties: { rowCount: number; columnCount: number };
  };
  data?: Array<{
    startRow?: number;
    startColumn?: number;
    rowData?: Array<{ values?: Array<{ formattedValue?: string; userEnteredValue?: any }> }>;
  }>;
}

// Cell values stored separately for easy access
export interface SheetValues {
  // key: "spreadsheetId:sheetTitle" -> 2D array of cell values
  [key: string]: string[][];
}

// === People ===

export interface PeopleStore {
  contacts: Record<string, Person>;
  contactGroups: Record<string, ContactGroup>;
}

export interface Person {
  resourceName: string;
  etag: string;
  names?: Array<{ displayName: string; familyName?: string; givenName?: string }>;
  emailAddresses?: Array<{ value: string; type?: string }>;
  phoneNumbers?: Array<{ value: string; type?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
}

export interface ContactGroup {
  resourceName: string;
  etag: string;
  name: string;
  groupType: 'USER_CONTACT_GROUP' | 'SYSTEM_CONTACT_GROUP';
  memberCount: number;
  memberResourceNames?: string[];
}
