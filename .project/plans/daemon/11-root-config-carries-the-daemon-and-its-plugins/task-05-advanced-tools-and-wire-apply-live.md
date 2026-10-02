---
title: advancedTools and wire apply live
status: done
depends: [task-02-the-daemons-keys.md]
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/host.ts#L8127-L8132](../../../../packages/sdk/src/host.ts#L8127-L8132) - the retool after `artifactToolsCompactPrompts`, the pattern"
  - "[code://packages/sdk/src/types/host.ts#L241](../../../../packages/sdk/src/types/host.ts#L241) - `advancedTools`"
---

## Objective

A write of `advancedTools` changes the tools of every running session as `artifactToolsCompactPrompts` does, and a write of `wire` starts, moves or stops the capture, both without `restartNeeded`.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `advancedTools` read when a session is tooled, and a way for the daemon to change it.
- `UPDATE: packages/server/src/commands/run.ts` and `packages/server/src/rootconfig.ts` - the capture reopened on `wire`.
- `UPDATE:` the tests of both.

## Steps

1. Tests first: after the write, a running session's tools list changes; a capture file named by `wire` receives the next frames.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
