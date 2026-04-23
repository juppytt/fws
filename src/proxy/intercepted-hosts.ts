/**
 * Hosts that the MITM proxy intercepts unconditionally because there is a
 * dedicated mock service mounted for them in src/server/routes/. Shared
 * between mitm.ts (which uses the list to decide what to intercept) and
 * the route layer (which uses it to decide whether an intercepted request
 * should go to a service route or to the Web Fetch catch-all).
 *
 * Lives in its own file to avoid a circular import: routes/fetch.ts and
 * mitm.ts already reference each other (mitm imports `hasFixtureForHost`
 * from routes/fetch), so the shared list cannot live in either of them.
 */
export const INTERCEPTED_HOSTS: readonly string[] = [
  // Google Workspace
  'gmail.googleapis.com',
  'www.googleapis.com',
  'tasks.googleapis.com',
  'workspaceevents.googleapis.com',
  'docs.googleapis.com',
  'slides.googleapis.com',
  'chat.googleapis.com',
  'classroom.googleapis.com',
  'forms.googleapis.com',
  'keep.googleapis.com',
  'meet.googleapis.com',
  'people.googleapis.com',
  'sheets.googleapis.com',
  'admin.googleapis.com',
  // GitHub
  'api.github.com',
  // github.com is intercepted for git smart HTTP (clone/fetch against
  // fws-seeded repos); REST/GraphQL continues to land on api.github.com.
  'github.com',
];

/** True when `hostname` is one of the built-in service hosts (or a subdomain of one). */
export function isAllowlistedHost(hostname: string): boolean {
  return INTERCEPTED_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h));
}
