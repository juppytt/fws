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

  // 3. Download from Google's public discovery API and save to fws cache
  const url = `${DISCOVERY_URL}/${api}/${version}/rest`;
  console.log(`Downloading discovery doc: ${api} ${version}...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();

  await fs.mkdir(localCacheDir, { recursive: true });
  await fs.writeFile(fwsCachePath, text);

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
