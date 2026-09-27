---
title: The comments and records of this plan say what is true
status: implemented
depends: [task-20-a-refusal-takes-its-sentence-and-the-group-hint-fails-like-the-others.md]
layer: "server, docs"
refs:
  - "[code://packages/server/src/commands/user.ts#L82](../../../../packages/server/src/commands/user.ts#L82) - `idOf`'s comment"
  - "[code://packages/server/src/commands/start.ts#L40-L47](../../../../packages/server/src/commands/start.ts#L40-L47) - `forwardedLine`'s comment and its example"
  - "[code://packages/server/src/commands/options.ts#L386](../../../../packages/server/src/commands/options.ts#L386) - the `updateCheck` fold"
---

## Objective

No comment under `commands/` describes code that is gone or a line that cannot reach it, and tasks 18, 20 and 21, the plan and the decision `an-untyped-flag-stays-absent-in-cofold-input` say what the code does.

## Files

- `UPDATE: packages/server/src/commands/user.ts:82` - the id comment.
- `UPDATE: packages/server/src/commands/start.ts:40-47` - the `forwardedLine` example.
- `UPDATE: task-18-start-forwards-its-options-wherever-they-are-typed.md` - Resume.
- `UPDATE: task-21-the-refs-follow-the-code.md` - Resume, and refs after task 20.
- `UPDATE: plan.md` - refs and Watch out for.
- `UPDATE: .project/decisions/an-untyped-flag-stays-absent-in-cofold-input.md` - the `options.ts` ref.
- `UPDATE: /github/cofold/packages/commands/src/input.test.ts` - the comment on the absent-flag case (uncommitted work from task 17).

## Steps

1. `user.ts:82`: say what the function is: the id a sub-command was given, one spelled like an option refused as an unknown flag would be.
2. `start.ts`: drop the `--connection-token --port` example, or write it as `--connection-token=--port`, which the parse accepts.
3. Task 18's Resume: the old slicing orphaned a daemon in about 3 runs of 8, because the parent records the pid of the `start` it spawned and the two writers of `daemon.json` race; the case counts the daemon's announcement lines, which catches it every time.
4. After task 20 lands, re-point the refs task 20 moved (`main.ts`, `user.ts`, `plugin.ts`) in tasks 05 to 20, and note it in task 21's Resume.
5. `plan.md`: the `host.ts` ref at `NEEDS` (L143), the Watch out for pointer to the scope pins (`server-commands.test.ts:59-69`), and the Resume state naming tasks by the statuses they have.
6. The decision's `options.ts` ref at the fold's line.
7. The cofold test comment says what an absent key means, not what the old code did.

## Validation

- Each named line re-read against the code.
- Every relative link in the touched files resolves; no em dash added.
- `node_modules/.bin/vitest run packages/server/test` green.

## Resume

Implemented 2026-09-26.

- `user.ts:82`: `idOf`'s comment says what it is, and its context type lost the `surface` field only `refuse` read.
- `start.ts:40-47`: the example is `--connection-token=--port`; `ahpd --connection-token=--port start --stdio` gets past the parse to `start`'s own `--stdio` refusal, and `ahpd --connection-token --port start --stdio` is refused by the parse.
- Task 18's Resume states the race and the 3 runs of 8; task 21's Resume says what task 23 re-pointed.
- Refs and `Files` ranges in tasks 05 to 20, 22 and 23 into `options.ts`, `main.ts`, `start.ts` and `server-cli.test.ts` were moved by the diff against HEAD and spot-read; task 20's refs name `stop` and the callers, task 16's ref note drops `refuse` and its Resume says task 20 removed it.
- `plan.md`: `NEEDS` at `host.ts#L143`, the scope pins at `server-commands.test.ts:59-69`, and the Resume state names tasks by the statuses in the table.
- The decision's fold ref is `options.ts#L386`.
- cofold's absent-flag comment in `packages/commands/src/input.test.ts` says what an absent key and `false` each mean; nothing else in cofold was touched.

Every relative link in the touched files resolves and none points past its file's end; no em dash was added. `node_modules/.bin/vitest run packages/server/test`: 225 passed.
