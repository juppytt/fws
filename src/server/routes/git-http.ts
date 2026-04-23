import { Router, Request, Response } from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getGitReposDir } from '../../util/paths.js';

// ── Git smart HTTP protocol mock ────────────────────────────────────────────
//
// Implements just enough of the git-upload-pack (clone/fetch) wire protocol
// that `git clone https://github.com/<owner>/<repo>.git` and `gh repo clone`
// can complete against an fws-managed bare repo. Push (git-receive-pack) is
// deliberately omitted — attack agents rarely need it, and accepting pushes
// into a shared fws instance would be a nasty cross-test side channel.
//
// Repos live at  <dataDir>/git/<owner>/<repo>.git  as real bare repos, so
// we delegate the actual pkt-line framing, ACK/NAK negotiation, and packfile
// generation to the local `git` binary via the stateless-rpc entry points.
// Callers seed content through the setup endpoint in control.ts.
//
// Protocol refs:
//   https://git-scm.com/docs/http-protocol
//   https://git-scm.com/docs/gitprotocol-http
// ───────────────────────────────────────────────────────────────────────────

const REFS_SERVICES = ['git-upload-pack'] as const;
type RefsService = typeof REFS_SERVICES[number];

/** Format a single pkt-line (4-byte hex length prefix + payload). */
function pktLine(payload: string): string {
  const length = payload.length + 4;
  return length.toString(16).padStart(4, '0') + payload;
}

/** Sanity-check owner/repo segments so we can't escape the git repos dir. */
function validIdent(s: string | undefined): s is string {
  return !!s && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(s) && s !== '.' && s !== '..';
}

function repoPath(owner: string, repo: string): string {
  return path.join(getGitReposDir(), owner, `${repo}.git`);
}

async function repoExists(owner: string, repo: string): Promise<boolean> {
  try {
    const st = await fs.stat(repoPath(owner, repo));
    return st.isDirectory();
  } catch {
    return false;
  }
}

export function gitHttpRoutes(): Router {
  const r = Router();

  // GET /:owner/:repo.git/info/refs?service=git-upload-pack
  //
  // Advertise the refs available for clone/fetch. We shell to
  // `git upload-pack --stateless-rpc --advertise-refs` and prepend the
  // service header pkt-line that smart HTTP clients expect.
  r.get(/^\/([^/]+)\/([^/]+)\.git\/info\/refs$/, async (req: Request, res: Response) => {
    const params = req.params as unknown as Record<string, string>;
    const owner = params[0];
    const repo = params[1];
    const service = typeof req.query.service === 'string' ? req.query.service : '';

    if (!validIdent(owner) || !validIdent(repo)) {
      return res.status(400).type('text/plain').send('invalid owner or repo');
    }
    if (!REFS_SERVICES.includes(service as RefsService)) {
      // Bare GET without ?service= is the dumb-HTTP protocol, which we don't
      // mock; refuse so clients fall back to smart HTTP (they'll retry with
      // the service query). Also refuse receive-pack to discourage pushes.
      return res.status(403).type('text/plain').send(`service not supported: ${service || '(none)'}`);
    }
    if (!(await repoExists(owner, repo))) {
      return res.status(404).type('text/plain').send(`repo not found: ${owner}/${repo}`);
    }

    res.setHeader('Content-Type', `application/x-${service}-advertisement`);
    res.setHeader('Cache-Control', 'no-cache');

    res.write(pktLine(`# service=${service}\n`));
    res.write('0000');

    const proc = spawn('git', [service.replace(/^git-/, ''), '--stateless-rpc', '--advertise-refs', repoPath(owner, repo)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.pipe(res);
    proc.on('close', () => {
      if (!res.writableEnded) res.end();
    });
    proc.on('error', (err) => {
      if (!res.headersSent) res.status(500).type('text/plain').send(`spawn failed: ${err.message}`);
      else if (!res.writableEnded) res.end();
    });
  });

  // POST /:owner/:repo.git/git-upload-pack
  //
  // The client streams its wants/haves in pkt-line format; we pipe those into
  // `git upload-pack --stateless-rpc`, which emits the packfile response.
  r.post(/^\/([^/]+)\/([^/]+)\.git\/git-upload-pack$/, async (req: Request, res: Response) => {
    const params = req.params as unknown as Record<string, string>;
    const owner = params[0];
    const repo = params[1];

    if (!validIdent(owner) || !validIdent(repo)) {
      return res.status(400).type('text/plain').send('invalid owner or repo');
    }
    if (!(await repoExists(owner, repo))) {
      return res.status(404).type('text/plain').send(`repo not found: ${owner}/${repo}`);
    }

    res.setHeader('Content-Type', 'application/x-git-upload-pack-result');
    res.setHeader('Cache-Control', 'no-cache');

    const proc = spawn('git', ['upload-pack', '--stateless-rpc', repoPath(owner, repo)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    req.pipe(proc.stdin);
    proc.stdout.pipe(res);
    proc.on('close', () => {
      if (!res.writableEnded) res.end();
    });
    proc.on('error', (err) => {
      if (!res.headersSent) res.status(500).type('text/plain').send(`spawn failed: ${err.message}`);
      else if (!res.writableEnded) res.end();
    });
  });

  // Refuse receive-pack outright so misbehaving clients can't push into the
  // shared fws instance.
  r.post(/^\/([^/]+)\/([^/]+)\.git\/git-receive-pack$/, (_req: Request, res: Response) => {
    res.status(403).type('text/plain').send('git-receive-pack is not supported by fws');
  });

  return r;
}

// ── Repo setup helpers (called from control.ts) ─────────────────────────────

export interface GitRepoFile {
  path: string;
  content: string;
}

export interface SetupGitRepoInput {
  owner: string;
  repo: string;
  /** Initial files to commit. Omit or pass [] to leave the repo empty. */
  files?: GitRepoFile[];
  /** Initial branch name; defaults to "main". */
  defaultBranch?: string;
  /** Commit message for the initial commit; defaults to "init". */
  commitMessage?: string;
  /** Author identity for the initial commit. */
  authorName?: string;
  authorEmail?: string;
}

/**
 * Create (or overwrite) a bare repo under the fws data dir, optionally
 * seeded with an initial commit. Returns the canonical clone URL.
 */
export async function setupGitRepo(input: SetupGitRepoInput): Promise<{ cloneUrl: string; repoDir: string }> {
  const { owner, repo } = input;
  if (!validIdent(owner) || !validIdent(repo)) {
    throw new Error(`invalid owner or repo: ${owner}/${repo}`);
  }
  const branch = input.defaultBranch ?? 'main';
  const authorName = input.authorName ?? 'fws';
  const authorEmail = input.authorEmail ?? 'fws@example.invalid';
  const commitMessage = input.commitMessage ?? 'init';

  const bareDir = repoPath(owner, repo);
  await fs.rm(bareDir, { recursive: true, force: true });
  await fs.mkdir(bareDir, { recursive: true });

  await runGit(['init', '--bare', '--initial-branch', branch, bareDir]);

  if (input.files && input.files.length > 0) {
    // Stage files in a temporary worktree and push the commit into the bare
    // repo. Using a worktree avoids leaving index/working tree state in the
    // bare repo itself.
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), `fws-git-${owner}-${repo}-`));
    try {
      await runGit(['init', '--initial-branch', branch, worktree]);
      await runGit(['-C', worktree, 'config', 'user.name', authorName]);
      await runGit(['-C', worktree, 'config', 'user.email', authorEmail]);

      for (const f of input.files) {
        const dest = path.join(worktree, f.path);
        if (!dest.startsWith(worktree + path.sep) && dest !== worktree) {
          throw new Error(`file path escapes worktree: ${f.path}`);
        }
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, f.content);
      }
      await runGit(['-C', worktree, 'add', '--all']);
      await runGit(['-C', worktree, 'commit', '-m', commitMessage, '--allow-empty']);
      await runGit(['-C', worktree, 'push', bareDir, `${branch}:${branch}`]);
    } finally {
      await fs.rm(worktree, { recursive: true, force: true });
    }
  }

  const cloneUrl = `https://github.com/${owner}/${repo}.git`;
  return { cloneUrl, repoDir: bareDir };
}

function runGit(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git ${args[0] ?? ''} failed (exit ${code}): ${stderr.trim()}`));
    });
    proc.on('error', reject);
  });
}

