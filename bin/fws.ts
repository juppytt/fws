#!/usr/bin/env tsx
import { Command } from 'commander';
import { createApp } from '../src/server/app.js';
import { resetStore, loadStore, serializeStore, deserializeStore } from '../src/store/index.js';
import { generateConfigDir } from '../src/config/rewrite-cache.js';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Server } from 'node:http';

const DEFAULT_PORT = 4100;

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

const program = new Command();
program
  .name('fws')
  .description('Fake Google Workspace — local mock server for gws CLI testing')
  .version('0.1.0');

// === Server commands ===
const serverCmd = program.command('server');

serverCmd
  .command('start')
  .description('Start the mock server')
  .option('-p, --port <port>', 'Port number', String(DEFAULT_PORT))
  .option('-s, --snapshot <name>', 'Load a snapshot on start')
  .action(async (opts) => {
    const port = parseInt(opts.port);

    if (opts.snapshot) {
      const snapshotPath = path.join(getSnapshotsDir(), opts.snapshot, 'store.json');
      try {
        const data = await fs.readFile(snapshotPath, 'utf-8');
        loadStore(deserializeStore(data));
        console.log(`Loaded snapshot: ${opts.snapshot}`);
      } catch {
        console.error(`Snapshot not found: ${opts.snapshot}`);
        process.exit(1);
      }
    }

    const configDir = path.join(getDataDir(), 'config');
    await generateConfigDir(port, configDir);

    const app = createApp();
    const server: Server = await new Promise((resolve) => {
      const s = app.listen(port, () => resolve(s));
    });

    await ensureDir(getDataDir());
    await fs.writeFile(getServerInfoPath(), JSON.stringify({ port, pid: process.pid }));

    console.log(`fws server listening on http://localhost:${port}`);
    console.log(`Config dir: ${configDir}`);
    console.log(`\nTo use with gws:`);
    console.log(`  export GOOGLE_WORKSPACE_CLI_CONFIG_DIR=${configDir}`);
    console.log(`  export GOOGLE_WORKSPACE_CLI_TOKEN=fake`);

    process.on('SIGINT', () => {
      server.close();
      fs.unlink(getServerInfoPath()).catch(() => {});
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      server.close();
      fs.unlink(getServerInfoPath()).catch(() => {});
      process.exit(0);
    });
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
  .command('status')
  .description('Show server status')
  .action(async () => {
    try {
      const info = JSON.parse(await fs.readFile(getServerInfoPath(), 'utf-8'));
      // Check if process is alive
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

// === Setup commands ===
const setupCmd = program.command('setup');
const setupGmail = setupCmd.command('gmail');

setupGmail
  .command('add-message')
  .description('Add a message to the mailbox')
  .requiredOption('--from <email>', 'From address')
  .option('--to <email>', 'To address')
  .option('--subject <text>', 'Subject line')
  .option('--body <text>', 'Message body')
  .option('--labels <list>', 'Comma-separated label IDs', 'INBOX,UNREAD')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .action(async (opts) => {
    const port = parseInt(opts.port);
    const res = await fetch(`http://localhost:${port}/__fws/setup/gmail/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: opts.from,
        to: opts.to,
        subject: opts.subject,
        body: opts.body,
        labels: opts.labels.split(','),
      }),
    });
    const data = await res.json();
    console.log(`Message added: ${data.id}`);
  });

const setupCalendar = setupCmd.command('calendar');

setupCalendar
  .command('add-event')
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
    const res = await fetch(`http://localhost:${port}/__fws/setup/calendar/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: opts.summary,
        start: opts.start,
        duration: opts.duration,
        calendar: opts.calendar === 'primary' ? undefined : opts.calendar,
        location: opts.location,
        attendees: opts.attendees?.split(','),
      }),
    });
    const data = await res.json();
    console.log(`Event added: ${data.id}`);
  });

const setupDrive = setupCmd.command('drive');

setupDrive
  .command('add-file')
  .description('Add a file to Drive')
  .requiredOption('--name <text>', 'File name')
  .option('--mimeType <type>', 'MIME type', 'application/octet-stream')
  .option('--parent <id>', 'Parent folder ID', 'root')
  .option('--size <bytes>', 'File size in bytes')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .action(async (opts) => {
    const port = parseInt(opts.port);
    const res = await fetch(`http://localhost:${port}/__fws/setup/drive/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: opts.name,
        mimeType: opts.mimeType,
        parent: opts.parent,
        size: opts.size ? parseInt(opts.size) : undefined,
      }),
    });
    const data = await res.json();
    console.log(`File added: ${data.id}`);
  });

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

// === Proxy mode (default): start server, run gws, exit ===
// If first arg is not a known subcommand, treat as gws proxy
const SUBCOMMANDS = ['server', 'snapshot', 'setup', 'reset', 'help', '--help', '-h', '--version', '-V'];

async function runProxy(args: string[]): Promise<void> {
  const port = DEFAULT_PORT;

  // Start server in-process
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fws-proxy-'));
  await generateConfigDir(port, configDir);

  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(port, () => resolve(s));
  });

  const gwsPath = process.env.GWS_PATH || 'gws';
  const env = {
    ...process.env,
    GOOGLE_WORKSPACE_CLI_CONFIG_DIR: configDir,
    GOOGLE_WORKSPACE_CLI_TOKEN: 'fake',
  };

  const child = spawn(gwsPath, args, { env, stdio: 'inherit' });

  child.on('close', async (code) => {
    server.close();
    await fs.rm(configDir, { recursive: true, force: true });
    process.exit(code ?? 0);
  });
}

// Main entry
const firstArg = process.argv[2];
if (firstArg && !SUBCOMMANDS.includes(firstArg)) {
  // Proxy mode
  runProxy(process.argv.slice(2));
} else {
  program.parse();
}
