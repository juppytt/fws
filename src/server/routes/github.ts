import { Router } from 'express';
import { getStore } from '../../store/index.js';
import type { GitHubComment } from '../../store/types.js';
import { generateId } from '../../util/id.js';

// Shared shape builders keep the issue-view and pr-view GraphQL paths in lockstep.
// gh's Go client nil-derefs on missing fields (see issue #26), so every path that
// returns a comments connection must go through these helpers.
function buildCommentNode(c: GitHubComment) {
  return {
    id: `C_${c.id}`,
    author: { login: c.user.login, id: `U_${c.user.id}`, name: c.user.login },
    authorAssociation: 'NONE',
    body: c.body,
    createdAt: c.created_at,
    includesCreatedEdit: false,
    isMinimized: false,
    minimizedReason: '',
    reactionGroups: [],
    url: c.html_url,
    viewerDidAuthor: false,
  };
}

function buildCommentsConnection(comments: GitHubComment[]) {
  return {
    nodes: comments.map(buildCommentNode),
    pageInfo: { hasNextPage: false, endCursor: null },
    totalCount: comments.length,
  };
}

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

    // Single PR by number (gh pr view)
    if (query.includes('pullRequest(number:') && !query.includes('pullRequests(') && !query.includes('projectItems')) {
      const repoOwner = variables.owner || store.github.user.login;
      const repoName = variables.repo || Object.values(store.github.repos)[0]?.name || '';
      const key = `${repoOwner}/${repoName}`;
      const num = variables.pr_number || variables.number || 0;

      const pull = store.github.pulls[key]?.[num];
      if (!pull) {
        return res.json({ data: { repository: { pullRequest: null } } });
      }

      const commentsKey = `${key}/issues/${num}`;
      const comments = store.github.comments[commentsKey] || [];

      return res.json({
        data: {
          repository: {
            pullRequest: {
              __typename: 'PullRequest',
              number: pull.number,
              url: pull.html_url,
              title: pull.title,
              body: pull.body || '',
              state: pull.state === 'merged' ? 'MERGED' : pull.state.toUpperCase(),
              createdAt: pull.created_at,
              isDraft: pull.draft,
              maintainerCanModify: true,
              mergeable: pull.mergeable ? 'MERGEABLE' : 'CONFLICTING',
              additions: 10,
              deletions: 3,
              headRefName: pull.head.ref,
              baseRefName: pull.base.ref,
              headRepositoryOwner: { id: `U_${pull.user.id}`, login: pull.user.login, name: pull.user.login },
              headRepository: { id: 'R_1', name: repoName },
              isCrossRepository: false,
              id: `PR_${pull.id}`,
              author: { login: pull.user.login, id: `U_${pull.user.id}`, name: pull.user.login },
              autoMergeRequest: null,
              reviewRequests: { nodes: [] },
              reviews: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null }, totalCount: 0 },
              assignees: { nodes: [], totalCount: 0 },
              labels: { nodes: [], totalCount: 0 },
              milestone: null,
              comments: buildCommentsConnection(comments),
              reactionGroups: [],
              commits: { totalCount: 1 },
              statusCheckRollup: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }] },
            },
          },
        },
      });
    }

    // Single issue/PR by number (gh issue view)
    if (query.includes('issueOrPullRequest')) {
      const repoOwner = variables.owner || store.github.user.login;
      const repoName = variables.repo || Object.values(store.github.repos)[0]?.name || '';
      const key = `${repoOwner}/${repoName}`;
      const num = variables.number || 0;

      if (!num) {
        return res.json({ data: { repository: { issue: null } } });
      }

      const issue = store.github.issues[key]?.[num];
      const pull = store.github.pulls[key]?.[num];
      const item = issue || pull;

      if (item) {
        const isIssue = !!issue;
        const commentsKey = `${key}/issues/${num}`;
        const comments = store.github.comments[commentsKey] || [];

        const node = {
                __typename: isIssue ? 'Issue' : 'PullRequest',
                number: item.number,
                url: (item as any).html_url,
                state: (item as any).state === 'merged' ? 'MERGED' : (item as any).state.toUpperCase(),
                stateReason: null,
                createdAt: item.created_at,
                title: item.title,
                body: item.body || '',
                id: `ID_${item.id}`,
                author: { login: item.user.login, id: `U_${item.user.id}`, name: item.user.login },
                milestone: null,
                assignees: {
                  nodes: isIssue ? (issue!.assignees || []).map(a => ({ id: `U_${a.id}`, login: a.login, name: a.login, databaseId: a.id })) : [],
                  totalCount: isIssue ? (issue!.assignees || []).length : 0,
                },
                labels: {
                  nodes: isIssue ? (issue!.labels || []).map(l => ({ id: `L_${l.id}`, name: l.name, description: '', color: l.color })) : [],
                  totalCount: isIssue ? (issue!.labels || []).length : 0,
                },
                reactionGroups: [],
                comments: buildCommentsConnection(comments),
                // PR-specific fields
                ...(pull ? {
                  headRefName: pull.head.ref,
                  baseRefName: pull.base.ref,
                  isDraft: pull.draft,
                  mergeable: pull.mergeable ? 'MERGEABLE' : 'CONFLICTING',
                } : {}),
        };
        return res.json({ data: { repository: { issue: node } } });
      }

      return res.json({ data: { repository: { issue: null, issueOrPullRequest: null } } });
    }

    // Issue list query (not single issue or project items)
    if ((query.includes('issues(') || query.includes('issues {')) && !query.includes('projectItems')) {
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

    if (query.includes('pullRequests(') || query.includes('pullRequests {')) {
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

    // Project items query stub
    if (query.includes('projectItems')) {
      const projectItems = { totalCount: 0, nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
      // Return only the field the query asks for
      const repoData: any = {};
      if (query.includes('issue(')) repoData.issue = { projectItems };
      if (query.includes('pullRequest(')) repoData.pullRequest = { projectItems };
      return res.json({ data: { repository: repoData } });
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
