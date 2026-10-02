---
title: Every option an agent offers is a control - implemented
date: 2026-10-02
---

Every `select` and `boolean` option an agent offers is a session control under `acp.<id>`, set through `session/set_config_option`; a `mode` option feeds `permissionMode`; a server with no options keeps the legacy model list and `session/set_model`.

## What was built

- `packages/agent-acp/src/session.ts` - `controlOptions`, `schemaOf`, `setConfig`; `connection.ts` - the boolean capability and `setModel`.
- Catalog tests for options, a `mode` option, a set before the first turn, and `set_model` on a legacy server.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm boundary` clean, `pnpm test` 166 files and 2488 tests, twice, after the rebase onto main.
- Read against the plan and reviewed by one reader per plan; the defects found were fixed in the same worktree before close.

## Departures from the plan

- Review fixed an option set before the session opened, and an open that failed rejecting instead of refusing.

## Left for later

- none.
