---
title: A machine is removed only once its work is out
status: done
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

- **Implemented** 2026-10-07 on `build/agents/4f2c8f8e`.
- `packages/computer/src/runtime.ts`: `running(found)` reads `State.Running` from the record `inspect` answered. `told(held, said)` throws for a git command that exited non-zero with text on stderr. A quiet non-zero exit passes through, so `rev-parse --verify --quiet` and `symbolic-ref -q` still answer "no such branch". The three git closures in `bringBackBranch`, `bringBackOfMachine` and `keepUncommitted` go through it.
- `remove` starts a machine that is not running before it reads, and only where there is something to read. The `ahpd.git` label is `fetch`, or the mounts name a copy tree. A start, a bring-back or a `keepUncommitted` that fails is caught and thrown again as `Could not remove <name>, so it is still here: <cause>`. That throw comes before the `rm -f`, so the machine and its volumes stay.
- `packages/computer/src/tools.ts`: `release_computer` answers that sentence rather than throwing it. `DELETE computer://` already did, through its `RpcError`.
- `packages/computer/src/plugin.ts`: the disposable timer takes the machine out of `disposables` only after a removal that worked. On a refusal it logs the sentence and arms the timer again.
- `computer-git-fetch.test.ts`: the four real-Docker cases below, plus `breakBranch` and `forceRemove`. The fsck case uses them, because a machine whose work cannot be brought out is no longer removed. Its `docker.remove` in the `finally` would leave a container and a volume behind.
- `computer-disposable.test.ts`: the scripted case below, named as the plan names it.
- **Found and left alone:** `leftOver()` in `computer-disposable.test.ts` and `computer-git-fetch.test.ts` reads the whole `TMPDIR` of the run, which every test file shares. A bundle directory another file has in flight reads as a leftover. Two of four full-package runs failed there, and one on `computer-needs.test.ts`; every file passes alone. The helper and its assertions are older than this plan, and no task here covers them.
