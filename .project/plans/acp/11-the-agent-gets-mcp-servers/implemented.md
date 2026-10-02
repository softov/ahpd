---
title: The agent gets the host's MCP servers - implemented
date: 2026-10-02
---

`mcpServers` is a root config key in VS Code's shape, applied to the next session without a restart; a session's servers reach a backend in `Start`; the host's own tools are an MCP endpoint per session, offered to an ACP agent that takes HTTP servers, opened once per session and closed with it.

## What was built

- `packages/server/src/rootconfig.ts` - the key, merged by entry and replaced on a type change, checked before it is live; `commands/run.ts` - the live holder; `packages/sdk/src/toolserver.ts` - the endpoint; `packages/agent-acp/src/session.ts` - `serversFor`.
- Root config, tool server and ACP tests; `docs/DAEMON.md`, `docs/PLUGINS.md`.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm boundary` clean, `pnpm test` 166 files and 2488 tests, twice, after the rebase onto main.
- Read against the plan and reviewed by one reader per plan; the defects found were fixed in the same worktree before close.

## Departures from the plan

- Review made the key live, filtered the `ahp` entry by `mcpCapabilities.http`, reused the endpoint across a respawn, compared the token in constant time, and logged a dropped stdio `cwd`.

## Left for later

- See [deferred.md](deferred.md).
