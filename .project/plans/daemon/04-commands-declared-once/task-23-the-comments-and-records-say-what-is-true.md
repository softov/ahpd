---
title: The comments and records of this plan say what is true
status: todo
depends: [task-20-a-refusal-takes-its-sentence-and-the-group-hint-fails-like-the-others.md]
layer: "server, docs"
refs:
  - "[code://packages/server/src/commands/user.ts#L79](../../../../packages/server/src/commands/user.ts#L79) - \"refused the way the loop refused a flag\", the removed hand-written loop"
  - "[code://packages/server/src/commands/start.ts#L40-L46](../../../../packages/server/src/commands/start.ts#L40-L46) - `forwardedLine`'s comment, whose example the strict parse refuses first"
  - "[code://packages/server/src/commands/options.ts#L394](../../../../packages/server/src/commands/options.ts#L394) - the `updateCheck` fold"
---

## Objective

No comment under `commands/` describes code that is gone or a line that cannot reach it, and tasks 18, 20 and 21, the plan and the decision `an-untyped-flag-stays-absent-in-cofold-input` say what the code does.

## Files

- `UPDATE: packages/server/src/commands/user.ts:79` - the id comment.
- `UPDATE: packages/server/src/commands/start.ts:40-46` - the `forwardedLine` example.
- `UPDATE: task-18-start-forwards-its-options-wherever-they-are-typed.md` - Resume.
- `UPDATE: task-21-the-refs-follow-the-code.md` - Resume, and refs after task 20.
- `UPDATE: plan.md` - refs and Watch out for.
- `UPDATE: .project/decisions/an-untyped-flag-stays-absent-in-cofold-input.md` - the `options.ts` ref.
- `UPDATE: /github/cofold/packages/commands/src/input.test.ts` - the comment on the absent-flag case (uncommitted work from task 17).

## Steps

1. `user.ts:79`: say what the function is: the id a sub-command was given, one spelled like an option refused as an unknown flag would be.
2. `start.ts`: drop the `--connection-token --port` example, or write it as `--connection-token=--port`, which the parse accepts.
3. Task 18's Resume: the old slicing orphaned a daemon in about 3 runs of 8, because the parent records the pid of the `start` it spawned and the two writers of `daemon.json` race; the case counts the daemon's announcement lines, which catches it every time.
4. After task 20 lands, re-point the refs task 20 moved (`main.ts`, `user.ts`, `plugin.ts`) in tasks 05 to 20, and note it in task 21's Resume.
5. `plan.md`: the `host.ts` ref at `NEEDS` (L143), the Watch out for pointer to the scope pins (`server-commands.test.ts:57-67`), and the Resume state naming tasks by the statuses they have.
6. The decision's `options.ts` ref at the fold's line.
7. The cofold test comment says what an absent key means, not what the old code did.

## Validation

- Each named line re-read against the code.
- Every relative link in the touched files resolves; no em dash added.
- `node_modules/.bin/vitest run packages/server/test` green.

## Resume
