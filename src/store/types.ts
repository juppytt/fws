// === Top-level store ===

export interface FwsStore {
  gmail: GmailStore;
  calendar: CalendarStore;
  drive: DriveStore;
  tasks: TasksStore;
  sheets: SheetsStore;
  people: PeopleStore;
  github: GitHubStore;
  search: SearchStore;
  webFetch: WebFetchStore;
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

// === GitHub ===

export interface GitHubStore {
  user: GitHubUser;
  repos: Record<string, GitHubRepo>;
  issues: Record<string, Record<number, GitHubIssue>>; // "owner/repo" -> number -> issue
  pulls: Record<string, Record<number, GitHubPull>>;
  comments: Record<string, GitHubComment[]>; // "owner/repo/issues/number" -> comments
}

export interface GitHubUser {
  login: string;
  id: number;
  name: string;
  email: string;
  avatar_url: string;
  html_url: string;
  type: 'User';
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string; id: number; type: string };
  private: boolean;
  html_url: string;
  description: string | null;
  fork: boolean;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  default_branch: string;
  open_issues_count: number;
  language: string | null;
  topics: string[];
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  labels: Array<{ id: number; name: string; color: string }>;
  assignees: Array<{ login: string; id: number }>;
  user: { login: string; id: number };
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  html_url: string;
  comments: number;
  pull_request?: { url: string };
}

export interface GitHubPull {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed' | 'merged';
  head: { ref: string; sha: string; label: string };
  base: { ref: string; sha: string; label: string };
  user: { login: string; id: number };
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
  html_url: string;
  mergeable: boolean | null;
  draft: boolean;
}

export interface GitHubComment {
  id: number;
  body: string;
  user: { login: string; id: number };
  created_at: string;
  updated_at: string;
  html_url: string;
}

// === Search ===

export interface SearchStore {
  /** Fixtures matched against query terms (case-insensitive substring on any keyword) */
  fixtures: SearchFixture[];
  /** Returned when no fixture matches */
  defaultResults: SearchResult[];
}

export interface SearchFixture {
  /** Keywords to look for in the query (case-insensitive). Match if ANY keyword appears. */
  keywords: string[];
  results: SearchResult[];
}

export interface SearchResult {
  title: string;
  link: string;
  displayLink: string;
  snippet: string;
}

// === Web Fetch ===
//
// Generic mock layer for arbitrary HTTP/HTTPS URLs accessed via curl/wget
// (or any HTTP client routed through the MITM proxy).
//
// Model is intentionally minimal: a fixture for a host (or specific URL)
// makes that host eligible for proxy interception. Hosts without any
// fixture are passed through to the real internet (in addition to the
// built-in allowlist of known service hosts like gmail.googleapis.com).
//
// There is no global "intercept everything" flag and no user-configurable
// default response — both turned out to be confusing knobs that the user
// surface didn't actually need. If a host gets intercepted (because it
// has a fixture for /v1) but a different path on the same host (/v2) is
// requested with no matching fixture, the catch-all returns a hardcoded
// default JSON body just so the client gets *something* back.

export interface WebFetchStore {
  /** Lookup order: exact URL first, then host-only. */
  fixtures: WebFetchFixture[];
}

export interface WebFetchFixture {
  /** Match the full URL exactly (including scheme, host, path, query). */
  url?: string;
  /** Match any path on this host (no scheme, just `example.com`). */
  host?: string;
  /** Match only this method (GET/POST/...). Omit to match any method. */
  method?: string;
  response: WebFetchResponse;
}

export interface WebFetchResponse {
  status: number;
  headers?: Record<string, string>;
  /** Response body as a string. Use base64 + a Content-Encoding/Content-Type header for binary. */
  body: string;
  /** When set to 'base64', the body is base64-encoded and will be decoded to a Buffer before sending. */
  bodyEncoding?: 'base64';
}
