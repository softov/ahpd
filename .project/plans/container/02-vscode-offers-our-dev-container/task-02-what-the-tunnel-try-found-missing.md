---
title: What the tunnel try found missing is fixed in ahpd
status: todo
depends: [task-01-the-tunnel-route-tried-by-hand.md]
layer: "sdk | tunnel-devtunnel"
refs:
  - "[code://packages/sdk/src/host.ts#L5140-L5149](../../../../packages/sdk/src/host.ts#L5140-L5149) - the `initialize` `_meta` block"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts](../../../../packages/tunnel-devtunnel/src/plugin.ts) - the tunnel plugin"
---

## Objective

VS Code connected through the tunnel offers "Use Dev Container" on a folder with a `devcontainer.json`, and the first send runs a session in that container.

## Files

Written from task 01's *Resume* before this task starts; a fork found there stops the task and goes to the plan's *Decisions locked in*.

## Steps

1. For each check task 01 recorded as failed, find the line in ahpd that answers it, fix it, and add a test that fails without the fix.
2. If nothing failed, mark this task `dropped` with that reason.

## Validation

- `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- Task 01's steps 4 and 5 repeated by hand, with the session running in the container.

## Resume
