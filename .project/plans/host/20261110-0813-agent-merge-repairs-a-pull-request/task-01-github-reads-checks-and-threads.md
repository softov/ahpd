---
title: GitHub reads checks and review threads
status: todo
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

