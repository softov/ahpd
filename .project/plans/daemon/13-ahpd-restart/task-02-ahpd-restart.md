---
title: "`ahpd restart`"
status: todo
depends: [task-01-the-record-keeps-the-argv.md]
layer: "server, sdk"
refs:
  - "[code://packages/server/src/commands/registry.ts#L38-L57](../../../../packages/server/src/commands/registry.ts#L38-L57) - where `stop` is registered"
  - "[code://packages/server/src/commands/run.ts#L570-L584](../../../../packages/server/src/commands/run.ts#L570-L584) - the shutdown"
---

## Objective

`daemon.restart` is `ahpd restart [--force]` and `POST /api/restart` as the plan's table says; the host answers which sessions have a turn running.

## Files

- `CREATE: packages/server/src/restart.ts` - the command.
- `UPDATE: packages/server/src/commands/registry.ts` and `served.ts` - registered locally and served.
- `UPDATE: packages/sdk/src/host.ts` and `packages/sdk/src/types/host.ts` - the running sessions, if no answer exists yet.
- `CREATE: packages/server/test/server-restart.test.ts` - the cases below.

## Steps

1. Tests first with a faked spawn: no daemon says so; a running turn refuses with the session named; `--force` stops and starts with the recorded argv; over HTTP a foreground daemon refuses; over HTTP a started one answers, then spawns and exits.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- By hand: the first three checks of the plan's checklist.

## Resume
