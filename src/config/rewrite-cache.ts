import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const DISCOVERY_SOURCES: Array<{ file: string; api: string; version: string }> = [
  { file: 'gmail_v1.json', api: 'gmail', version: 'v1' },
  { file: 'calendar_v3.json', api: 'calendar', version: 'v3' },
  { file: 'drive_v3.json', api: 'drive', version: 'v3' },
  { file: 'tasks_v1.json', api: 'tasks', version: 'v1' },
  { file: 'sheets_v4.json', api: 'sheets', version: 'v4' },
  { file: 'people_v1.json', api: 'people', version: 'v1' },
];

const DISCOVERY_URL = 'https://www.googleapis.com/discovery/v1/apis';

// Persistent local cache so we only download once
const localCacheDir = path.join(os.homedir(), '.local', 'share', 'fws', 'discovery-cache');

async function readOrDownload(file: string, api: string, version: string): Promise<string> {
  // 1. Try local gws cache
  const gwsCachePath = path.join(
    process.env.GWS_SOURCE_CONFIG_DIR || path.join(os.homedir(), '.config', 'gws'),
    'cache',
    file,
  );
  try {
    return await fs.readFile(gwsCachePath, 'utf-8');
  } catch {}

  // 2. Try fws local cache
  const fwsCachePath = path.join(localCacheDir, file);
  try {
    return await fs.readFile(fwsCachePath, 'utf-8');
  } catch {}

  // 3. Download from Google's public discovery API and save to fws cache.
  //    Atomic write: write to a unique temp file in the same directory, then
  //    rename(2) into place. Without this, concurrent vitest workers race —
  //    one worker creates a partial file, another reads the empty file and
  //    crashes with `SyntaxError: Unexpected end of JSON input`.
  const url = `${DISCOVERY_URL}/${api}/${version}/rest`;
  console.log(`Downloading discovery doc: ${api} ${version}...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();

  await fs.mkdir(localCacheDir, { recursive: true });
  const tmpPath = `${fwsCachePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(tmpPath, text);
  try {
    await fs.rename(tmpPath, fwsCachePath);
  } catch (err) {
    // Another worker may have already renamed its temp file into place
    // between our writeFile and our rename. That's fine — clean up our
    // tempfile and read whatever's there now.
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }

  return text;
}

export async function generateConfigDir(port: number, targetDir: string): Promise<string> {
  const cacheDir = path.join(targetDir, 'cache');
  await fs.mkdir(cacheDir, { recursive: true });

  const localUrl = `http://localhost:${port}/`;

  for (const { file, api, version } of DISCOVERY_SOURCES) {
    const raw = await readOrDownload(file, api, version);
    const data = JSON.parse(raw);

    data.rootUrl = localUrl;
    if (data.baseUrl) {
      data.baseUrl = localUrl + (data.servicePath || '');
    }
    if (data.mtlsRootUrl) {
      data.mtlsRootUrl = localUrl;
    }

    await fs.writeFile(path.join(cacheDir, file), JSON.stringify(data));
  }

  return targetDir;
}
