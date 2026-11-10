---
title: GitHub reads checks and review threads
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/repo/github.ts#L34](../../../../packages/sdk/src/repo/github.ts#L34) - `githubPullRequests`, the sibling"
---

## Objective

`repo/github.ts` reads a pull request's required checks, their jobs and logs, its review threads and its mergeable state, through `gh` or a lent token.

## Files

- `UPDATE: packages/sdk/src/repo/github.ts:34` - the new reads beside `githubPullRequests`.
- `UPDATE: packages/sdk/src/types/github.ts` - the types of what is read.
- `UPDATE: packages/sdk/test` - the cases, with a stand-in `gh` and a stand-in API.

## Steps

1. Read what VS Code's controller reads at 171e90619, and list each GitHub call it makes.
2. Add each read beside `githubPullRequests`, through the same token or `gh`.
3. Cap a log read at 48 KB, as `readAgentMergeCI` says.
4. Answer nothing, not an error, where `gh` and a token are both missing.

## Validation

- A case for each read, with a stand-in.
- `pnpm typecheck`, then the sdk suite.

## Resume

- **Done so far:** `PullRequests` has optional `detail`, `jobs` and `jobLog`, and `githubPullRequests()` answers all three. `detail` reads the pull request's REST core, its check runs and commit statuses on the head, the base branch's required status checks, and one GraphQL query for review threads, submitted reviews and conversation comments. `jobs` reads a workflow run's jobs and steps; `jobLog` reads one job's log capped at 48,000 characters with `truncated`. Each read uses a lent token over `fetch`, or `gh api` / `gh api graphql` without one, and answers nothing rather than failing where neither route exists. The new types are exported from `types/index.ts`.
- **Next action:** [task-02-the-watch-starts-a-repair-turn.md](task-02-the-watch-starts-a-repair-turn.md).
- **Open questions:** none for this task.
- **Watch out for:** a 404 on branch protection is a complete answer of no required checks, while a 403 (or any other refusal) leaves `requirednessComplete` false and every `required` absent. `viewerCanMerge` reads the base repository's permissions, because that is where a merge writes.

Files changed by this task: `packages/sdk/src/repo/github.ts`, `packages/sdk/src/types/github.ts`, `packages/sdk/src/types/index.ts`, `packages/sdk/test/github.test.ts`, `docs/updates/v0_15.md`.

