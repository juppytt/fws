# GitHub API Support Status

fws mocks the GitHub REST API and a subset of GraphQL, accessed via the `gh` CLI through the MITM proxy.

All supported endpoints are validated through actual `gh` CLI commands in `test/gh-validation.test.ts` (15 tests).

## Setup

```bash
fws server start
eval $(fws server env)

# gh commands now hit the local mock
gh issue list
gh api /user
```

Requires: `GH_TOKEN=fake`, `HTTPS_PROXY`, `SSL_CERT_FILE` (set by `fws server env`).
Optional: `GH_REPO=testuser/my-project` (needed for `gh issue list`, `gh pr list`).

## REST API

| gh command | Method | Path | Status |
|------------|--------|------|--------|
| `gh api /user` | GET | /user | ✅ gh-tested |
| `gh api /users/:username` | GET | /users/:username | ✅ gh-tested |
| `gh api /user/repos` | GET | /user/repos | ✅ gh-tested |
| `gh api /user/repos` | POST | /user/repos | ✅ gh-tested |
| `gh api /repos/:owner/:repo` | GET | /repos/:owner/:repo | ✅ gh-tested |
| `gh api /repos/.../issues` | GET | /repos/:owner/:repo/issues | ✅ gh-tested |
| `gh api /repos/.../issues` | POST | /repos/:owner/:repo/issues | ✅ gh-tested |
| `gh api /repos/.../issues/:n` | GET | /repos/:owner/:repo/issues/:number | ✅ gh-tested |
| `gh api /repos/.../issues/:n` | PATCH | /repos/:owner/:repo/issues/:number | ✅ gh-tested |
| `gh api /repos/.../issues/:n/comments` | GET | /repos/:owner/:repo/issues/:number/comments | ✅ gh-tested |
| `gh api /repos/.../issues/:n/comments` | POST | /repos/:owner/:repo/issues/:number/comments | ✅ gh-tested |
| `gh api /repos/.../pulls` | GET | /repos/:owner/:repo/pulls | ✅ gh-tested |
| `gh api /repos/.../pulls` | POST | /repos/:owner/:repo/pulls | ✅ gh-tested |
| `gh api /repos/.../pulls/:n` | GET | /repos/:owner/:repo/pulls/:number | ✅ gh-tested |
| `gh api /repos/.../pulls/:n` | PATCH | /repos/:owner/:repo/pulls/:number | ✅ gh-tested |
| `gh api /repos/.../pulls/:n/merge` | PUT | /repos/:owner/:repo/pulls/:number/merge | ✅ gh-tested |
| `gh api /repos/.../labels` | GET | /repos/:owner/:repo/labels | ✅ gh-tested |
| `gh api /search/issues` | GET | /search/issues?q=... | ✅ gh-tested |

## GraphQL

| gh command | Query | Status |
|------------|-------|--------|
| `gh issue list` | repository.issues | ✅ gh-tested |
| `gh issue view N` | repository.issueOrPullRequest | ✅ gh-tested |
| `gh pr list` | repository.pullRequests | ✅ gh-tested |
| `gh pr view N` | repository.pullRequest | ✅ gh-tested |
| Project items queries | repository.issue/pullRequest.projectItems | ✅ stub (returns empty) |

## Seed data

| Resource | Data |
|----------|------|
| User | `testuser` (Test User, testuser@example.com) |
| Repo | `testuser/my-project` (TypeScript, public, 2 open issues) |
| Issue #1 | "Fix login bug" (open, bug label, assigned to testuser, 1 comment from bob) |
| Issue #2 | "Add dark mode support" (open, enhancement label) |
| PR #3 | "Fix SSO login flow" (open, fix/sso-login -> main, Fixes #1) |
| Comment | bob on issue #1: "I can reproduce this. Happens with Google SSO specifically." |
