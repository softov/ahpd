---
title: pi's edits reach the host's changesets - implemented
date: 2026-09-28
refs:
  - git://1d00d3f
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) - `editing`, `announceEdit`, `settleEdit` and the sweep in `finish`"
---

A file pi's `edit` or `write` tool changes shows in the host's changeset for the turn, as it does for the claude and cofold backends.

## What was built

- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - an `editing` map by pi's call id; `before` on `tool_execution_start` for `edit` and `write` with a string `path`, resolved with `piPath` against the working directory, and `after` on `tool_execution_end`; `finish` settles every call still open on its own turn id, however the turn ends.

## Verified

- `packages/agent-pi/test/agent-pi.test.ts`: an `edit` on a relative path with a `read` beside it, a `write` that never ends, and an open edit settled on its own turn when `prompt` throws; each failed before its fix.
- `pnpm test` 104 files, 1440 tests; `pnpm typecheck` and `pnpm boundary` green.
- Reviewed by Softov on 2026-09-28.

## Departures from the plan

- The sweep of open calls sits in `finish` rather than in `agent_settled`; Softov moved it on 2026-09-27 so a thrown `prompt` and a cancel close their calls too.

## Left for later

- none.
