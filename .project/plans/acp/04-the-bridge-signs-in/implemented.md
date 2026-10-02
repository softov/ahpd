---
title: The bridge signs in, and says when an agent needs it - implemented
date: 2026-10-02
---

A spec's `authenticate` method is sent after `initialize` and before a session opens; an `auth_required` answer ends the turn as its own error naming the methods offered; a server that refuses the sign-in fails the turn with its own message.

## What was built

- `packages/agent-acp/src/session.ts` - `signIn`, `signInFailure`; `packages/agent-acp/src/plugin.ts` - the `authenticate` option; `connection.ts` - `authenticate` on the current SDK entry.
- `agent-acp-signin.test.ts`; fixture flags `--signin` and `--signin-fails`.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm boundary` clean, `pnpm test` 166 files and 2488 tests, twice, after the rebase onto main.
- Read against the plan and reviewed by one reader per plan; the defects found were fixed in the same worktree before close.

## Departures from the plan

- Review added the server's own message when it refuses `authenticate`.

## Left for later

- none.
