import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers/harness.js';

describe('Drive', () => {
  let h: TestHarness;

  beforeAll(async () => {
    h = await createTestHarness();
  });

  afterAll(async () => {
    await h.cleanup();
  });

  describe('about', () => {
    it('returns about info', async () => {
      const res = await h.fetch('/drive/v3/about?fields=*');
      const data = await res.json();
      expect(data.kind).toBe('drive#about');
      expect(data.user.emailAddress).toBe('testuser@example.com');
    });

    it('returns about via gws', async () => {
      const { stdout, exitCode } = await h.gws('drive about get --params {"fields":"*"}');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.kind).toBe('drive#about');
    });
  });

  describe('files', () => {
    it('lists seed files initially', async () => {
      const res = await h.fetch('/drive/v3/files');
      const data = await res.json();
      expect(data.files.length).toBe(5);
      expect(data.files.some((f: any) => f.id === 'file001')).toBe(true);
    });

    it('creates a file', async () => {
      const res = await h.fetch('/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'report.pdf', mimeType: 'application/pdf' }),
      });
      const file = await res.json();
      expect(file.name).toBe('report.pdf');
      expect(file.id).toBeTruthy();
    });

    it('gets file by id', async () => {
      const createRes = await h.fetch('/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'get-test.txt', mimeType: 'text/plain' }),
      });
      const file = await createRes.json();

      const getRes = await h.fetch(`/drive/v3/files/${file.id}`);
      const got = await getRes.json();
      expect(got.name).toBe('get-test.txt');
    });

    it('patches file name', async () => {
      const createRes = await h.fetch('/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'old-name.txt' }),
      });
      const file = await createRes.json();

      const patchRes = await h.fetch(`/drive/v3/files/${file.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new-name.txt' }),
      });
      const patched = await patchRes.json();
      expect(patched.name).toBe('new-name.txt');
    });

    it('deletes a file', async () => {
      const createRes = await h.fetch('/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'delete-me.txt' }),
      });
      const file = await createRes.json();

      const delRes = await h.fetch(`/drive/v3/files/${file.id}`, { method: 'DELETE' });
      expect(delRes.status).toBe(204);

      const getRes = await h.fetch(`/drive/v3/files/${file.id}`);
      expect(getRes.status).toBe(404);
    });

    it('copies a file', async () => {
      const createRes = await h.fetch('/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'original.txt', mimeType: 'text/plain' }),
      });
      const original = await createRes.json();

      const copyRes = await h.fetch(`/drive/v3/files/${original.id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'copied.txt' }),
      });
      const copy = await copyRes.json();
      expect(copy.name).toBe('copied.txt');
      expect(copy.id).not.toBe(original.id);
      expect(copy.mimeType).toBe('text/plain');
    });

    it('filters by q name contains', async () => {
      const res = await h.fetch("/drive/v3/files?q=name%20contains%20'report'");
      const data = await res.json();
      expect(data.files.every((f: any) => f.name.toLowerCase().includes('report'))).toBe(true);
    });

    it('filters by q mimeType', async () => {
      const res = await h.fetch("/drive/v3/files?q=mimeType%20%3D%20'application/pdf'");
      const data = await res.json();
      expect(data.files.every((f: any) => f.mimeType === 'application/pdf')).toBe(true);
    });

    it('creates and lists file via gws roundtrip', async () => {
      // Setup via control endpoint
      const setup = await h.fetch('/__fws/setup/drive/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'gws-test.pdf', mimeType: 'application/pdf' }),
      });
      const { id } = await setup.json();

      // List via gws
      const { stdout, exitCode } = await h.gws('drive files list');
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.files.some((f: any) => f.id === id)).toBe(true);
    });

    it('gets file via gws', async () => {
      const listRes = await h.fetch('/drive/v3/files');
      const list = await listRes.json();
      const fileId = list.files[0].id;

      const { stdout, exitCode } = await h.gws(`drive files get --params {"fileId":"${fileId}"}`);
      expect(exitCode).toBe(0);
      const file = JSON.parse(stdout);
      expect(file.id).toBe(fileId);
    });
  });
});
