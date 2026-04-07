import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers/harness.js';

describe('Snapshot', () => {
  let h: TestHarness;

  beforeAll(async () => {
    h = await createTestHarness();
  });

  afterAll(async () => {
    await h.cleanup();
  });

  it('save returns current state as JSON', async () => {
    const res = await h.fetch('/__fws/snapshot/save', { method: 'POST' });
    const data = await res.json();
    expect(data.gmail).toBeDefined();
    expect(data.calendar).toBeDefined();
    expect(data.drive).toBeDefined();
  });

  it('full roundtrip: add data, snapshot, reset, verify empty, load, verify data', async () => {
    // 1. Add some data
    await h.fetch('/__fws/setup/gmail/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'snap@example.com', subject: 'Snapshot Test', body: 'snapshot body' }),
    });
    await h.fetch('/__fws/setup/calendar/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: 'Snapshot Event', start: '2026-06-01T10:00:00Z', duration: '1h' }),
    });
    await h.fetch('/__fws/setup/drive/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'snapshot-file.txt' }),
    });

    // 2. Snapshot
    const snapRes = await h.fetch('/__fws/snapshot/save', { method: 'POST' });
    const snapshot = await snapRes.json();
    expect(Object.keys(snapshot.gmail.messages).length).toBeGreaterThan(0);

    // 3. Reset
    await h.fetch('/__fws/reset', { method: 'POST' });

    // 4. Verify reset to seed (5 seed messages, 5 seed files — the extras we added are gone)
    const msgsRes = await h.fetch('/gmail/v1/users/me/messages');
    const msgs = await msgsRes.json();
    expect(msgs.messages.length).toBe(5); // only seed messages

    const filesRes = await h.fetch('/drive/v3/files');
    const files = await filesRes.json();
    expect(files.files.length).toBe(5); // only seed files

    // 5. Load snapshot
    await h.fetch('/__fws/snapshot/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    });

    // 6. Verify data restored (seed + our extras)
    const msgsRes2 = await h.fetch('/gmail/v1/users/me/messages');
    const msgs2 = await msgsRes2.json();
    expect(msgs2.messages.length).toBeGreaterThan(5); // seed + added

    const filesRes2 = await h.fetch('/drive/v3/files');
    const files2 = await filesRes2.json();
    expect(files2.files.length).toBeGreaterThan(5); // seed + added

    // Verify via gws
    const { stdout, exitCode } = await h.gws('gmail users messages list --params {"userId":"me"}');
    expect(exitCode).toBe(0);
    const gwsMsgs = JSON.parse(stdout);
    expect(gwsMsgs.messages.length).toBeGreaterThan(0);
  });
});
