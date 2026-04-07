import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const CACHE_FILES = ['gmail_v1.json', 'calendar_v3.json', 'drive_v3.json'];

export async function generateConfigDir(port: number, targetDir: string): Promise<string> {
  const sourceConfigDir = process.env.GWS_SOURCE_CONFIG_DIR
    || path.join(os.homedir(), '.config', 'gws');
  const cacheDir = path.join(targetDir, 'cache');
  await fs.mkdir(cacheDir, { recursive: true });

  const localUrl = `http://localhost:${port}/`;

  for (const file of CACHE_FILES) {
    const sourcePath = path.join(sourceConfigDir, 'cache', file);
    const raw = await fs.readFile(sourcePath, 'utf-8');
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
