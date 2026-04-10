#!/usr/bin/env tsx
import { Command } from 'commander';
import { createApp } from '../src/server/app.js';
import { loadStore, deserializeStore } from '../src/store/index.js';
import { generateConfigDir } from '../src/config/rewrite-cache.js';
import { generateCACert, startMitmProxy } from '../src/proxy/mitm.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Server } from 'node:http';

const DEFAULT_PORT = 4100;
const DEFAULT_PROXY_PORT = 4101;

function getDataDir(): string {
  return process.env.FWS_DATA_DIR || path.join(os.homedir(), '.local', 'share', 'fws');
}

function getSnapshotsDir(): string {
  return path.join(getDataDir(), 'snapshots');
}

function getServerInfoPath(): string {
  return path.join(getDataDir(), 'server.json');
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

import { createRequire } from 'node:module';
const pkg = createRequire(import.meta.url)('../package.json');

const program = new Command();
program
  .name('fws')
  .description('Fake Web Services — local mock server for testing CLI tools and agents without real credentials')
  .version(pkg.version);

// === Server commands ===
const serverCmd = program.command('server');

serverCmd
  .command('start')
  .description('Start the mock server in the background')
  .option('-p, --port <port>', 'Port number', String(DEFAULT_PORT))
  .option('-s, --snapshot <name>', 'Load a snapshot on start')
  .option('--foreground', 'Run in foreground (used internally)')
  .action(async (opts) => {
    const port = parseInt(opts.port);

    if (opts.foreground) {
      // Actually run the server (called by the background spawner below)
      if (opts.snapshot) {
        const snapshotPath = path.join(getSnapshotsDir(), opts.snapshot, 'store.json');
        try {
          const data = await fs.readFile(snapshotPath, 'utf-8');
          loadStore(deserializeStore(data));
        } catch {
          console.error(`Snapshot not found: ${opts.snapshot}`);
          process.exit(1);
        }
      }

      const configDir = path.join(getDataDir(), 'config');
      await generateConfigDir(port, configDir);

      // Generate CA cert for MITM proxy
      const { caPath } = await generateCACert(getDataDir());

      const app = createApp();
      const server: Server = await new Promise((resolve) => {
        const s = app.listen(port, () => resolve(s));
      });

      // Start MITM proxy for helper commands (+triage, +send, etc.)
      const proxyPort = port + 1;
      const proxyServer = startMitmProxy(port, proxyPort);

      await ensureDir(getDataDir());
      await fs.writeFile(getServerInfoPath(), JSON.stringify({
        port, proxyPort, pid: process.pid, caPath,
      }));

      const shutdown = () => {
        server.close();
        proxyServer.close();
        fs.unlink(getServerInfoPath()).catch(() => {});
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      return;
    }

    // Kill existing server if any
    try {
      const info = JSON.parse(await fs.readFile(getServerInfoPath(), 'utf-8'));
      try {
        process.kill(info.pid, 'SIGTERM');
        await new Promise(r => setTimeout(r, 300));
      } catch {}
      await fs.unlink(getServerInfoPath()).catch(() => {});
    } catch {}

    // Spawn the server as a detached background process
    const configDir = path.join(getDataDir(), 'config');
    await ensureDir(getDataDir());
    await generateConfigDir(port, configDir);

    const logFile = path.join(getDataDir(), 'server.log');
    // Truncate log on each start so it's fresh
    const logFd = await fs.open(logFile, 'w');

    const args = ['server', 'start', '--foreground', '-p', String(port)];
    if (opts.snapshot) args.push('-s', opts.snapshot);

    const tsxPath = path.join(import.meta.dirname, '..', 'node_modules', '.bin', 'tsx');
    const scriptPath = path.join(import.meta.dirname, 'fws.ts');

    const child = spawn(tsxPath, [scriptPath, ...args], {
      detached: true,
      stdio: ['ignore', logFd.fd, logFd.fd],
    });
    child.unref();

    // Retry health check a few times (server needs time to start)
    let started = false;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 300));
      try {
        const res = await fetch(`http://localhost:${port}/__fws/status`);
        if (res.ok) {
          started = true;
          break;
        }
      } catch {}
    }

    await logFd.close();

    if (started) {
      // Read server info to get caPath and proxyPort
      const serverInfo = JSON.parse(await fs.readFile(getServerInfoPath(), 'utf-8').catch(() => '{}'));
      const proxyPort = serverInfo.proxyPort || port + 1;
      const caPath = serverInfo.caPath || path.join(getDataDir(), 'certs', 'ca.crt');

      console.log(`fws server started on port ${port} (pid ${child.pid})\n`);
      console.log(`Run this to configure your shell:\n`);
      console.log(`  eval $(fws server env)\n`);
      console.log(`Or set manually:\n`);
      console.log(`  export GOOGLE_WORKSPACE_CLI_CONFIG_DIR=${configDir}`);
      console.log(`  export GOOGLE_WORKSPACE_CLI_TOKEN=fake`);
      console.log(`  export HTTPS_PROXY=http://localhost:${proxyPort}`);
      console.log(`  export SSL_CERT_FILE=${caPath}`);
      console.log(`  export GH_TOKEN=fake`);
      console.log(`  export GH_REPO=testuser/my-project\n`);
      console.log(`Then try:\n`);
      console.log(`  gws gmail +triage`);
      console.log(`  gws drive files list`);
      console.log(`  gh issue list`);
      console.log(`  gh api /user\n`);
      console.log(`Stop with: fws server stop`);
    } else {
      const log = await fs.readFile(logFile, 'utf-8').catch(() => '');
      console.error('Failed to start server.');
      if (log.trim()) {
        console.error('\nServer log:\n' + log);
      }
    }
  });

serverCmd
  .command('stop')
  .description('Stop the running mock server')
  .action(async () => {
    try {
      const info = JSON.parse(await fs.readFile(getServerInfoPath(), 'utf-8'));
      process.kill(info.pid, 'SIGTERM');
      await fs.unlink(getServerInfoPath());
      console.log(`Stopped fws server (pid ${info.pid})`);
    } catch {
      console.log('No running server found');
    }
  });

serverCmd
  .command('env')
  .description('Print export statements for shell (use with eval)')
  .action(async () => {
    try {
      const info = JSON.parse(await fs.readFile(getServerInfoPath(), 'utf-8'));
      const configDir = path.join(getDataDir(), 'config');
      const caPath = info.caPath || path.join(getDataDir(), 'certs', 'ca.crt');
      const proxyPort = info.proxyPort || info.port + 1;

      console.log(`export GOOGLE_WORKSPACE_CLI_CONFIG_DIR=${configDir}`);
      console.log(`export GOOGLE_WORKSPACE_CLI_TOKEN=fake`);
      console.log(`export HTTPS_PROXY=http://localhost:${proxyPort}`);
      console.log(`export SSL_CERT_FILE=${caPath}`);
      console.log(`export GH_TOKEN=fake`);
      console.log(`export GH_REPO=testuser/my-project`);
    } catch {
      console.error('No running server found. Start with: fws server start');
      process.exit(1);
    }
  });

serverCmd
  .command('status')
  .description('Show server status')
  .action(async () => {
    try {
      const info = JSON.parse(await fs.readFile(getServerInfoPath(), 'utf-8'));
      try {
        process.kill(info.pid, 0);
        console.log(`Server running on port ${info.port} (pid ${info.pid})`);
      } catch {
        console.log('Server info exists but process is not running');
        await fs.unlink(getServerInfoPath()).catch(() => {});
      }
    } catch {
      console.log('No server running');
    }
  });

// === Snapshot commands ===
const snapshotCmd = program.command('snapshot');

snapshotCmd
  .command('save <name>')
  .description('Save current server state as a snapshot')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .action(async (name, opts) => {
    const port = parseInt(opts.port);
    const res = await fetch(`http://localhost:${port}/__fws/snapshot/save`, { method: 'POST' });
    const data = await res.text();

    const snapshotDir = path.join(getSnapshotsDir(), name);
    await ensureDir(snapshotDir);
    await fs.writeFile(path.join(snapshotDir, 'store.json'), data);
    console.log(`Snapshot saved: ${name}`);
  });

snapshotCmd
  .command('load <name>')
  .description('Load a snapshot into the running server')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .action(async (name, opts) => {
    const port = parseInt(opts.port);
    const snapshotPath = path.join(getSnapshotsDir(), name, 'store.json');
    const data = await fs.readFile(snapshotPath, 'utf-8');

    await fetch(`http://localhost:${port}/__fws/snapshot/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data,
    });
    console.log(`Snapshot loaded: ${name}`);
  });

snapshotCmd
  .command('list')
  .description('List available snapshots')
  .action(async () => {
    const dir = getSnapshotsDir();
    try {
      const entries = await fs.readdir(dir);
      if (entries.length === 0) {
        console.log('No snapshots');
      } else {
        for (const name of entries) {
          console.log(`  ${name}`);
        }
      }
    } catch {
      console.log('No snapshots');
    }
  });

snapshotCmd
  .command('delete <name>')
  .description('Delete a snapshot')
  .action(async (name) => {
    const snapshotDir = path.join(getSnapshotsDir(), name);
    await fs.rm(snapshotDir, { recursive: true, force: true });
    console.log(`Snapshot deleted: ${name}`);
  });

// === Service data-injection commands ===
//
// Each command is a thin wrapper around the corresponding /__fws/setup/...
// HTTP endpoint on a running daemon. Naming convention is `fws <service>
// <action>`, flat at the top level — no `setup` namespace, since the
// service name is already the namespace.

async function postSetup(port: number, urlPath: string, body: object): Promise<any> {
  const res = await fetch(`http://localhost:${port}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${urlPath} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// fws gmail add
program
  .command('gmail')
  .description("Inject data into the running daemon's gmail mailbox")
  .addCommand(
    new Command('add')
      .description('Add a message to the mailbox')
      .requiredOption('--from <email>', 'From address')
      .option('--to <email>', 'To address')
      .option('--subject <text>', 'Subject line')
      .option('--body <text>', 'Message body')
      .option('--labels <list>', 'Comma-separated label IDs', 'INBOX,UNREAD')
      .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
      .action(async (opts) => {
        const port = parseInt(opts.port);
        const data = await postSetup(port, '/__fws/setup/gmail/message', {
          from: opts.from,
          to: opts.to,
          subject: opts.subject,
          body: opts.body,
          labels: opts.labels.split(','),
        });
        console.log(`Message added: ${data.id}`);
      }),
  );

// fws calendar add
program
  .command('calendar')
  .description("Inject data into the running daemon's calendar")
  .addCommand(
    new Command('add')
      .description('Add an event to a calendar')
      .requiredOption('--summary <text>', 'Event title')
      .requiredOption('--start <datetime>', 'Start time (ISO 8601)')
      .option('--duration <dur>', 'Duration (e.g. 30m, 1h, 2h)', '1h')
      .option('--calendar <id>', 'Calendar ID', 'primary')
      .option('--location <text>', 'Location')
      .option('--attendees <list>', 'Comma-separated attendee emails')
      .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
      .action(async (opts) => {
        const port = parseInt(opts.port);
        const data = await postSetup(port, '/__fws/setup/calendar/event', {
          summary: opts.summary,
          start: opts.start,
          duration: opts.duration,
          calendar: opts.calendar === 'primary' ? undefined : opts.calendar,
          location: opts.location,
          attendees: opts.attendees?.split(','),
        });
        console.log(`Event added: ${data.id}`);
      }),
  );

// fws drive add
program
  .command('drive')
  .description("Inject data into the running daemon's drive")
  .addCommand(
    new Command('add')
      .description('Add a file to Drive')
      .requiredOption('--name <text>', 'File name')
      .option('--mimeType <type>', 'MIME type', 'application/octet-stream')
      .option('--parent <id>', 'Parent folder ID', 'root')
      .option('--size <bytes>', 'File size in bytes')
      .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
      .action(async (opts) => {
        const port = parseInt(opts.port);
        const data = await postSetup(port, '/__fws/setup/drive/file', {
          name: opts.name,
          mimeType: opts.mimeType,
          parent: opts.parent,
          size: opts.size ? parseInt(opts.size) : undefined,
        });
        console.log(`File added: ${data.id}`);
      }),
  );

// fws search add
program
  .command('search')
  .description("Inject Custom Search fixtures")
  .addCommand(
    new Command('add')
      .description('Add a Custom Search fixture (keywords → results)')
      .requiredOption('--keywords <list>', 'Comma-separated keywords (case-insensitive substring match)')
      .requiredOption('--results <json>', 'JSON array of {title,link,displayLink,snippet}')
      .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
      .action(async (opts) => {
        const port = parseInt(opts.port);
        let results: unknown;
        try {
          results = JSON.parse(opts.results);
        } catch (e) {
          console.error(`--results is not valid JSON: ${(e as Error).message}`);
          process.exit(1);
        }
        await postSetup(port, '/__fws/setup/search/fixture', {
          keywords: opts.keywords.split(','),
          results,
        });
        console.log('Search fixture added');
      }),
  );

// fws fetch add
program
  .command('fetch')
  .description('Inject Web Fetch fixtures (mock arbitrary HTTP/HTTPS URLs)')
  .addCommand(
    new Command('add')
      .description('Add a Web Fetch fixture. Specify either --url (exact match) or --host (any path on this host).')
      .option('--url <url>', 'Exact URL to mock (https://example.com/foo)')
      .option('--host <host>', 'Hostname to mock (example.com — matches any path)')
      .option('--method <verb>', 'HTTP method to filter on (omit for any)')
      .option('--status <code>', 'Response status code', '200')
      .option('--body <text>', 'Response body (string)', '')
      .option('--header <kv...>', 'Response header in "Name: Value" form (repeatable)')
      .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
      .action(async (opts) => {
        if (!opts.url && !opts.host) {
          console.error('one of --url or --host is required');
          process.exit(1);
        }
        const headers: Record<string, string> = {};
        if (Array.isArray(opts.header)) {
          for (const h of opts.header) {
            const idx = (h as string).indexOf(':');
            if (idx <= 0) {
              console.error(`bad --header value (expected "Name: Value"): ${h}`);
              process.exit(1);
            }
            headers[(h as string).slice(0, idx).trim()] = (h as string).slice(idx + 1).trim();
          }
        }
        const port = parseInt(opts.port);
        await postSetup(port, '/__fws/setup/fetch/fixture', {
          url: opts.url,
          host: opts.host,
          method: opts.method,
          response: {
            status: parseInt(opts.status),
            headers: Object.keys(headers).length > 0 ? headers : undefined,
            body: opts.body,
          },
        });
        console.log('Fetch fixture added');
      }),
  );

// === Reset command ===
program
  .command('reset')
  .description('Reset server to seed data or a snapshot')
  .option('-s, --snapshot <name>', 'Load this snapshot after reset')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .action(async (opts) => {
    const port = parseInt(opts.port);

    if (opts.snapshot) {
      const snapshotPath = path.join(getSnapshotsDir(), opts.snapshot, 'store.json');
      const data = await fs.readFile(snapshotPath, 'utf-8');
      await fetch(`http://localhost:${port}/__fws/snapshot/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: data,
      });
      console.log(`Reset to snapshot: ${opts.snapshot}`);
    } else {
      await fetch(`http://localhost:${port}/__fws/reset`, { method: 'POST' });
      console.log('Reset to seed data');
    }
  });

// The implicit "proxy mode" (any unknown first-arg → spawn temporary
// daemon and forward to gws) used to live here. It was removed because
// the flat top-level commands (`fws gmail add`, `fws calendar add`, ...)
// conflict with the gws command names it would forward (`fws gmail
// users messages list`). The replacement is the explicit two-step:
//
//   fws server start
//   eval $(fws server env)
//   gws gmail users messages list
//   fws server stop

program.parse();
