import { Router } from 'express';
import { getStore } from '../../store/index.js';
import { generateId } from '../../util/id.js';

export function githubRoutes(): Router {
  const r = Router();
  // gh api sends to api.github.com without prefix
  // GH Enterprise uses /api/v3/ prefix
  // Support both
  const P = '';

  // === GraphQL ===
  // gh issue list, gh pr list, etc. use GraphQL
  r.post('/graphql', (req, res) => {
    const store = getStore();
    const query = req.body.query || '';
    const variables = req.body.variables || {};

    // Detect what the query is asking for and return appropriate data
    if (query.includes('issues') || query.includes('Issue')) {
      const repoOwner = variables.owner || store.github.user.login;
      const repoName = variables.repo || Object.values(store.github.repos)[0]?.name || '';
      const key = `${repoOwner}/${repoName}`;
      const issues = Object.values(store.github.issues[key] || {});
      const states = variables.states || ['OPEN'];

      const filteredIssues = issues.filter(i => {
        const gqlState = i.state.toUpperCase();
        return states.includes(gqlState);
      });

      return res.json({
        data: {
          repository: {
            hasIssuesEnabled: true,
            issues: {
              totalCount: filteredIssues.length,
              nodes: filteredIssues.map(i => ({
                number: i.number,
                title: i.title,
                state: i.state.toUpperCase(),
                createdAt: i.created_at,
                updatedAt: i.updated_at,
                author: { login: i.user.login },
                labels: { nodes: i.labels.map(l => ({ name: l.name, color: l.color })) },
                assignees: { nodes: i.assignees.map(a => ({ login: a.login })) },
                url: i.html_url,
              })),
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      });
    }

    if (query.includes('pullRequests') || query.includes('PullRequest')) {
      const repoOwner = variables.owner || store.github.user.login;
      const repoName = variables.repo || Object.values(store.github.repos)[0]?.name || '';
      const key = `${repoOwner}/${repoName}`;
      const pulls = Object.values(store.github.pulls[key] || {});
      const states = variables.states || ['OPEN'];

      const filteredPulls = pulls.filter(p => {
        const gqlState = p.state === 'merged' ? 'MERGED' : p.state.toUpperCase();
        return states.includes(gqlState);
      });

      return res.json({
        data: {
          repository: {
            pullRequests: {
              totalCount: filteredPulls.length,
              nodes: filteredPulls.map(p => ({
                number: p.number,
                title: p.title,
                state: p.state === 'merged' ? 'MERGED' : p.state.toUpperCase(),
                createdAt: p.created_at,
                updatedAt: p.updated_at,
                author: { login: p.user.login },
                headRefName: p.head.ref,
                baseRefName: p.base.ref,
                isDraft: p.draft,
                url: p.html_url,
              })),
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      });
    }

    // Fallback for unknown queries
    res.json({ data: {} });
  });

  // === User ===

  r.get(`${P}/user`, (_req, res) => {
    res.json(getStore().github.user);
  });

  r.get(`${P}/users/:username`, (req, res) => {
    const store = getStore();
    if (req.params.username === store.github.user.login) {
      return res.json(store.github.user);
    }
    res.status(404).json({ message: 'Not Found' });
  });

  // === Repos ===

  r.get(`${P}/repos/:owner/:repo`, (req, res) => {
    const key = `${req.params.owner}/${req.params.repo}`;
    const repo = getStore().github.repos[key];
    if (!repo) {
      return res.status(404).json({ message: 'Not Found' });
    }
    res.json(repo);
  });

  r.get(`${P}/user/repos`, (_req, res) => {
    res.json(Object.values(getStore().github.repos));
  });

  r.post(`${P}/user/repos`, (req, res) => {
    const store = getStore();
    const name = req.body.name || 'new-repo';
    const fullName = `${store.github.user.login}/${name}`;
    const now = new Date().toISOString();
    const repo = {
      id: Math.floor(Math.random() * 100000),
      name,
      full_name: fullName,
      owner: { login: store.github.user.login, id: store.github.user.id, type: 'User' },
      private: req.body.private || false,
      html_url: `https://github.com/${fullName}`,
      description: req.body.description || null,
      fork: false,
      created_at: now,
      updated_at: now,
      pushed_at: now,
      default_branch: 'main',
      open_issues_count: 0,
      language: null,
      topics: [],
    };
    store.github.repos[fullName] = repo;
    store.github.issues[fullName] = {};
    store.github.pulls[fullName] = {};
    res.status(201).json(repo);
  });

  // === Issues ===

  r.get(`${P}/repos/:owner/:repo/issues`, (req, res) => {
    const key = `${req.params.owner}/${req.params.repo}`;
    const issuesMap = getStore().github.issues[key];
    if (!issuesMap) {
      return res.status(404).json({ message: 'Not Found' });
    }
    let issues = Object.values(issuesMap);
    const state = req.query.state as string || 'open';
    if (state !== 'all') {
      issues = issues.filter(i => i.state === state);
    }
    // Include PRs unless filtered out
    const pullsMap = getStore().github.pulls[key] || {};
    if (state !== 'all') {
      const prs = Object.values(pullsMap).filter(p => p.state === state);
      const prIssues = prs.map(p => ({
        ...p,
        labels: [],
        assignees: [],
        comments: 0,
        pull_request: { url: `${P}/repos/${key}/pulls/${p.number}` },
      }));
      issues = [...issues, ...prIssues as any];
    }
    issues.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json(issues);
  });

  r.get(`${P}/repos/:owner/:repo/issues/:number`, (req, res) => {
    const key = `${req.params.owner}/${req.params.repo}`;
    const num = parseInt(req.params.number);
    const issue = getStore().github.issues[key]?.[num];
    if (!issue) {
      // Check pulls
      const pull = getStore().github.pulls[key]?.[num];
      if (pull) return res.json({ ...pull, pull_request: { url: '' } });
      return res.status(404).json({ message: 'Not Found' });
    }
    res.json(issue);
  });

  r.post(`${P}/repos/:owner/:repo/issues`, (req, res) => {
    const key = `${req.params.owner}/${req.params.repo}`;
    const store = getStore();
    if (!store.github.issues[key]) store.github.issues[key] = {};

    const existing = Object.values(store.github.issues[key]);
    const existingPulls = Object.values(store.github.pulls[key] || {});
    const maxNum = Math.max(0, ...existing.map(i => i.number), ...existingPulls.map(p => p.number));
    const num = maxNum + 1;
    const now = new Date().toISOString();

    const issue = {
      id: Math.floor(Math.random() * 100000),
      number: num,
      title: req.body.title || '',
      body: req.body.body || null,
      state: 'open' as const,
      labels: (req.body.labels || []).map((l: string, i: number) => ({ id: i + 100, name: l, color: '000000' })),
      assignees: (req.body.assignees || []).map((a: string) => ({ login: a, id: 0 })),
      user: { login: store.github.user.login, id: store.github.user.id },
      created_at: now,
      updated_at: now,
      closed_at: null,
      html_url: `https://github.com/${key}/issues/${num}`,
      comments: 0,
    };
    store.github.issues[key][num] = issue;

    // Update repo issue count
    const repo = store.github.repos[key];
    if (repo) repo.open_issues_count++;

    res.status(201).json(issue);
  });

  r.patch(`${P}/repos/:owner/:repo/issues/:number`, (req, res) => {
    const key = `${req.params.owner}/${req.params.repo}`;
    const num = parseInt(req.params.number);
    const store = getStore();
    const issue = store.github.issues[key]?.[num];
    if (!issue) {
      return res.status(404).json({ message: 'Not Found' });
    }
    const wasOpen = issue.state === 'open';
    Object.assign(issue, req.body, { number: num, id: issue.id });
    issue.updated_at = new Date().toISOString();
    if (req.body.state === 'closed' && !issue.closed_at) {
      issue.closed_at = new Date().toISOString();
    }
    // Update count
    const repo = store.github.repos[key];
    if (repo) {
      if (wasOpen && issue.state === 'closed') repo.open_issues_count--;
      if (!wasOpen && issue.state === 'open') repo.open_issues_count++;
    }
    res.json(issue);
  });

  // === Issue Comments ===

  r.get(`${P}/repos/:owner/:repo/issues/:number/comments`, (req, res) => {
    const key = `${req.params.owner}/${req.params.repo}/issues/${req.params.number}`;
    const comments = getStore().github.comments[key] || [];
    res.json(comments);
  });

  r.post(`${P}/repos/:owner/:repo/issues/:number/comments`, (req, res) => {
    const issueKey = `${req.params.owner}/${req.params.repo}/issues/${req.params.number}`;
    const store = getStore();
    if (!store.github.comments[issueKey]) store.github.comments[issueKey] = [];

    const now = new Date().toISOString();
    const comment = {
      id: Math.floor(Math.random() * 100000),
      body: req.body.body || '',
      user: { login: store.github.user.login, id: store.github.user.id },
      created_at: now,
      updated_at: now,
      html_url: `https://github.com/${req.params.owner}/${req.params.repo}/issues/${req.params.number}#issuecomment-${Date.now()}`,
    };
    store.github.comments[issueKey].push(comment);

    // Update issue comment count
    const repoKey = `${req.params.owner}/${req.params.repo}`;
    const num = parseInt(req.params.number);
    const issue = store.github.issues[repoKey]?.[num];
    if (issue) issue.comments++;

    res.status(201).json(comment);
  });

  // === Pull Requests ===

  r.get(`${P}/repos/:owner/:repo/pulls`, (req, res) => {
    const key = `${req.params.owner}/${req.params.repo}`;
    const pullsMap = getStore().github.pulls[key];
    if (!pullsMap) {
      return res.status(404).json({ message: 'Not Found' });
    }
    let pulls = Object.values(pullsMap);
    const state = req.query.state as string || 'open';
    if (state !== 'all') {
      pulls = pulls.filter(p => p.state === state);
    }
    res.json(pulls);
  });

  r.get(`${P}/repos/:owner/:repo/pulls/:number`, (req, res) => {
    const key = `${req.params.owner}/${req.params.repo}`;
    const num = parseInt(req.params.number);
    const pull = getStore().github.pulls[key]?.[num];
    if (!pull) {
      return res.status(404).json({ message: 'Not Found' });
    }
    res.json(pull);
  });

  r.post(`${P}/repos/:owner/:repo/pulls`, (req, res) => {
    const key = `${req.params.owner}/${req.params.repo}`;
    const store = getStore();
    if (!store.github.pulls[key]) store.github.pulls[key] = {};

    const existingIssues = Object.values(store.github.issues[key] || {});
    const existingPulls = Object.values(store.github.pulls[key]);
    const maxNum = Math.max(0, ...existingIssues.map(i => i.number), ...existingPulls.map(p => p.number));
    const num = maxNum + 1;
    const now = new Date().toISOString();

    const pull = {
      id: Math.floor(Math.random() * 100000),
      number: num,
      title: req.body.title || '',
      body: req.body.body || null,
      state: 'open' as const,
      head: { ref: req.body.head || 'feature', sha: generateId(8), label: `${store.github.user.login}:${req.body.head || 'feature'}` },
      base: { ref: req.body.base || 'main', sha: generateId(8), label: `${store.github.user.login}:${req.body.base || 'main'}` },
      user: { login: store.github.user.login, id: store.github.user.id },
      created_at: now,
      updated_at: now,
      merged_at: null,
      closed_at: null,
      html_url: `https://github.com/${key}/pull/${num}`,
      mergeable: true,
      draft: req.body.draft || false,
    };
    store.github.pulls[key][num] = pull;
    res.status(201).json(pull);
  });

  r.patch(`${P}/repos/:owner/:repo/pulls/:number`, (req, res) => {
    const key = `${req.params.owner}/${req.params.repo}`;
    const num = parseInt(req.params.number);
    const store = getStore();
    const pull = store.github.pulls[key]?.[num];
    if (!pull) {
      return res.status(404).json({ message: 'Not Found' });
    }
    Object.assign(pull, req.body, { number: num, id: pull.id });
    pull.updated_at = new Date().toISOString();
    if (req.body.state === 'closed' && !pull.closed_at) {
      pull.closed_at = new Date().toISOString();
    }
    res.json(pull);
  });

  // Merge PR
  r.put(`${P}/repos/:owner/:repo/pulls/:number/merge`, (req, res) => {
    const key = `${req.params.owner}/${req.params.repo}`;
    const num = parseInt(req.params.number);
    const store = getStore();
    const pull = store.github.pulls[key]?.[num];
    if (!pull) {
      return res.status(404).json({ message: 'Not Found' });
    }
    if (pull.state !== 'open') {
      return res.status(405).json({ message: 'Pull request is not mergeable' });
    }
    pull.state = 'merged';
    pull.merged_at = new Date().toISOString();
    pull.closed_at = pull.merged_at;
    res.json({
      sha: generateId(8),
      merged: true,
      message: 'Pull Request successfully merged',
    });
  });

  // === Labels ===

  r.get(`${P}/repos/:owner/:repo/labels`, (req, res) => {
    const key = `${req.params.owner}/${req.params.repo}`;
    const issues = Object.values(getStore().github.issues[key] || {});
    const labelMap = new Map<string, any>();
    for (const issue of issues) {
      for (const label of issue.labels) {
        labelMap.set(label.name, label);
      }
    }
    res.json(Array.from(labelMap.values()));
  });

  // === Search ===

  r.get(`${P}/search/issues`, (req, res) => {
    const q = (req.query.q as string || '').toLowerCase();
    const store = getStore();
    const results: any[] = [];

    for (const [repoKey, issuesMap] of Object.entries(store.github.issues)) {
      for (const issue of Object.values(issuesMap)) {
        const text = `${issue.title} ${issue.body || ''} ${issue.labels.map(l => l.name).join(' ')}`.toLowerCase();
        if (text.includes(q) || q.includes(`repo:${repoKey}`)) {
          results.push(issue);
        }
      }
    }

    res.json({
      total_count: results.length,
      incomplete_results: false,
      items: results,
    });
  });

  return r;
}
