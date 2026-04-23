import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestHarness, type TestHarness } from './helpers/harness.js';

const execFileP = promisify(execFile);

async function gitClone(url: string, dest: string): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileP('git', ['clone', '--no-hardlinks', url, dest], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 30_000,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? String(err), code: e.code ?? 1 };
  }
}

describe('git smart HTTP', () => {
  let h: TestHarness;
  const workdirs: string[] = [];

  beforeAll(async () => {
    h = await createTestHarness();
  });

  afterAll(async () => {
    for (const d of workdirs) {
      await rm(d, { recursive: true, force: true }).catch(() => {});
    }
    await h.cleanup();
  });

  async function mkWorkdir(): Promise<string> {
    const d = await mkdtemp(path.join(tmpdir(), 'fws-git-test-'));
    workdirs.push(d);
    return d;
  }

  it('404s on info/refs for an unknown repo', async () => {
    const res = await h.fetch('/ghost/missing.git/info/refs?service=git-upload-pack');
    expect(res.status).toBe(404);
  });

  it('rejects info/refs without a supported service', async () => {
    // First seed a repo so existence check passes; then we know the service
    // guard is the one saying no.
    await h.fetch('/__fws/setup/github/repo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'octo', repo: 'svc-guard' }),
    });
    const res = await h.fetch('/octo/svc-guard.git/info/refs?service=git-receive-pack');
    expect(res.status).toBe(403);
  });

  it('rejects path-traversal owner/repo names', async () => {
    const res = await h.fetch('/__fws/setup/github/repo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: '..', repo: 'evil' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('can seed a repo and clone it end-to-end', async () => {
    const setupRes = await h.fetch('/__fws/setup/github/repo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner: 'octo',
        repo: 'hello',
        defaultBranch: 'main',
        files: [
          { path: 'README.md', content: '# hello from fws\n' },
          { path: 'src/index.js', content: 'console.log("hi");\n' },
        ],
      }),
    });
    expect(setupRes.status).toBe(200);
    const setupBody = await setupRes.json();
    expect(setupBody.cloneUrl).toBe('https://github.com/octo/hello.git');

    const dest = path.join(await mkWorkdir(), 'hello');
    const { code, stderr } = await gitClone(`http://127.0.0.1:${h.port}/octo/hello.git`, dest);
    expect(code, stderr).toBe(0);

    const readme = await readFile(path.join(dest, 'README.md'), 'utf-8');
    expect(readme).toBe('# hello from fws\n');
    const src = await readFile(path.join(dest, 'src/index.js'), 'utf-8');
    expect(src).toBe('console.log("hi");\n');
  }, 45_000);

  it('clones through the MITM proxy against https://github.com/<owner>/<repo>.git', async () => {
    // Regression: the MITM proxy buffers the mock response and re-emits it as
    // a single block. If it passes through the upstream `Transfer-Encoding:
    // chunked` header while writing the body un-chunked, git aborts with
    // "Malformed encoding found in chunked-encoding" mid-clone.
    await h.fetch('/__fws/setup/github/repo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner: 'octo',
        repo: 'via-proxy',
        files: [{ path: 'README.md', content: 'via proxy\n' }],
      }),
    });

    const dest = path.join(await mkWorkdir(), 'via-proxy');
    const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
      execFile(
        'git',
        ['clone', '--no-hardlinks', 'https://github.com/octo/via-proxy.git', dest],
        {
          env: {
            ...process.env,
            HTTPS_PROXY: `http://localhost:${h.proxyPort}`,
            SSL_CERT_FILE: h.caBundlePath,
            GIT_SSL_CAINFO: h.caBundlePath,
            GIT_TERMINAL_PROMPT: '0',
          },
          timeout: 30_000,
        },
        (err, out, errOut) => {
          resolve({
            stdout: out ?? '',
            stderr: errOut ?? '',
            code: err ? ((err as { code?: number }).code ?? 1) : 0,
          });
        },
      );
    });

    expect(code, `stdout=${stdout}\nstderr=${stderr}`).toBe(0);
    const readme = await readFile(path.join(dest, 'README.md'), 'utf-8');
    expect(readme).toBe('via proxy\n');
  }, 45_000);

  it('refuses push via git-receive-pack', async () => {
    await h.fetch('/__fws/setup/github/repo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'octo', repo: 'push-denied', files: [{ path: 'README.md', content: 'x\n' }] }),
    });
    const dest = path.join(await mkWorkdir(), 'push-denied');
    const { code: cloneCode } = await gitClone(`http://127.0.0.1:${h.port}/octo/push-denied.git`, dest);
    expect(cloneCode).toBe(0);

    // Attempt a push: add a commit and push to origin.
    await execFileP('git', ['-C', dest, 'config', 'user.email', 'test@fws.invalid']);
    await execFileP('git', ['-C', dest, 'config', 'user.name', 'test']);
    await execFileP('git', ['-C', dest, 'commit', '--allow-empty', '-m', 'x']);
    try {
      await execFileP('git', ['-C', dest, 'push', 'origin', 'HEAD'], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        timeout: 10_000,
      });
      throw new Error('push should have failed');
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? '';
      expect(stderr).toMatch(/not supported|403/i);
    }
  }, 30_000);
});
