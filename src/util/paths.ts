import os from 'node:os';
import path from 'node:path';

/**
 * Resolve the fws data directory.
 *
 * Matches the definition in bin/fws.ts so src-side code (routes, middlewares)
 * can look up the same directory without importing from bin/.
 */
export function getDataDir(): string {
  return process.env.FWS_DATA_DIR || path.join(os.homedir(), '.local', 'share', 'fws');
}

export function getGitReposDir(): string {
  return path.join(getDataDir(), 'git');
}
