---
title: A machine is removed only once its work is out
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L3127-L3153](../../../../packages/computer/src/runtime.ts#L3127-L3153) - `remove`"
  - "[code://packages/computer/src/tools.ts#L125-L131](../../../../packages/computer/src/tools.ts#L125-L131) - `release_computer`"
  - "[code://packages/computer/src/provider.ts#L412-L419](../../../../packages/computer/src/provider.ts#L412-L419) - `DELETE computer://`"
  - "[code://packages/computer/src/plugin.ts#L861-L869](../../../../packages/computer/src/plugin.ts#L861-L869) - the disposable timer"
---

## Objective

`remove` empties a stopped machine by starting it first, and keeps a machine whose work it could not bring out.

## Files

- `UPDATE: packages/computer/src/runtime.ts:2200` - a failed `rev-parse` with output on stderr throws.
- `UPDATE: packages/computer/src/runtime.ts:2347-2352` - a failed branch list throws.
- `UPDATE: packages/computer/src/runtime.ts:2393` - a failed `status` throws.
- `UPDATE: packages/computer/src/runtime.ts:3127-3153` - start a stopped machine, and refuse when the work cannot come out.
- `UPDATE: packages/computer/src/tools.ts:125-131` - answer the refusal sentence.
- `UPDATE: packages/computer/src/plugin.ts:861-869` - log the refusal and arm the timer again.
- `UPDATE: packages/computer/test/computer-git-fetch.test.ts` - the real-Docker cases below.

## Steps

1. Read whether the machine runs with `docker inspect`, before the bring-back in `remove`.
2. Start a stopped machine with `docker start`.
3. Make each git call in the bring-back throw when it exits non-zero with text on stderr.
4. Keep `rev-parse --verify --quiet` with no stderr as "no such branch".
5. When the start, the bring-back or `keepUncommitted` throws, throw from `remove` before `rm -f`.
6. Word the error as one sentence that names the machine and keeps the cause.
7. Leave the machine and its volumes in place on that error.
8. In the disposable timer, log the sentence and arm the timer again.

## Validation

- `computer-git-fetch.test.ts` holds these real-Docker cases:
  - `it('brings back the commits of a stopped machine before it removes it')`
  - `it('keeps the uncommitted files of a stopped copy machine before it removes it')`
  - `it('keeps a machine whose work cannot be brought back, and says why')`
  - `it('release_computer answers the refusal and the machine is still there')`
- A scripted case: `it('a disposable machine that refuses removal is tried again')`.
- Run the full gates from the plan. All pass, and the real-Docker cases ran.

## Resume

