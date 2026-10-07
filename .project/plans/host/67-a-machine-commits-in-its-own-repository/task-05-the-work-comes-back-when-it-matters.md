---
title: The work comes back when a turn ends, before an operation, when a session leaves and before a machine goes
status: done
depends: [task-04-ahpd-brings-the-work-back-by-fetch.md]
layer: "sdk, computer"
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L626-L634](../../../../packages/sdk/src/host/spawn.ts#L626-L634) - a finished or cancelled turn"
  - "[code://packages/sdk/src/host/machines.ts#L70-L80](../../../../packages/sdk/src/host/machines.ts#L70-L80) - `inMachine`, where a session leaves"
  - "[code://packages/sdk/src/changes.ts#L223-L345](../../../../packages/sdk/src/changes.ts#L223-L345) - the changeset operations"
  - "[code://packages/computer/src/runtime.ts#L2164-L2172](../../../../packages/computer/src/runtime.ts#L2164-L2172) - `remove`"
---

## Objective

ahpd calls `bringBack` for a session's machine when a turn ends or is cancelled, before any changeset operation runs on its folder, when the session leaves the machine, and `remove` calls it before the container goes; the facts and the changeset are read after it.

## Files

- `UPDATE: packages/sdk/src/host/spawn.ts:626-634` - `bringBack` of the machine the session is in (`enteredIn`), then `refreshFacts`.
- `UPDATE: packages/sdk/src/host/changesets.ts` - before an operation on a folder whose session is in a machine, `bringBack` first; a `waiting` answer refuses the operation with the log's sentence.
- `UPDATE: packages/sdk/src/host/machines.ts:70-80` - on leave, `bringBack` before the port's `leave`.
- `UPDATE: packages/computer/src/runtime.ts:2164-2172` - `remove` brings back first; a failure is logged and the removal goes on, the hidden ref kept.
- `UPDATE: packages/sdk/test/` - a fake `ComputerPort` counting calls.

## Steps

1. Failing case first: a fake port's `bringBack` is not called when a turn completes.
2. Wire the four moments; each failure is a log line, never a failed turn.
3. A changeset read does not call it (decision 1's row in the plan).

## Validation

- sdk test: `bringBack` once on `turnComplete`, once on `turnCancelled`, before `commit` runs, on leave; not on a changeset read; a rejection logs and the turn still completes.
- `computer-disposable.test.ts`: `remove` runs the bundle before `rm -f`.
- `npx vitest run packages/sdk/test packages/computer` passes.

## Resume

- **Implemented** 2026-10-06 on `build/agents/c016a0e4`.
- `packages/sdk/src/host/machines.ts` is where the four moments meet one helper, so a failure is a log line in one place and a session's name is normalised once. `askedOf(id, uri)` calls `options.computers?.bringBack?.(id)`, and a port that throws is `computers: bringing the work of <id> back for <uri> failed: <message>` in the log and no answer rather than a throw - every moment this is asked at goes on without it. `bringBackOf(uri)` normalises through `ctx.heldAs` (a client holds `ahp-session:/one`, this host holds `echo:/one`) and reads the machine out of `enteredIn`, answering nothing for a session in no machine. `letGo(id, uri)` fetches and then calls the port's `leave`; it takes the id rather than reading `enteredIn` because the caller clears the map before the deferred promise runs, and a machine whose work was never fetched because of that order is a machine whose volume goes with the commits still in it. `inMachine(id, uri, false)` now routes through `letGo`, which is how both a disposal and a forgotten session let a machine go. `Machines` gains `bringBackOf`, and `packages/sdk/src/host.ts` hands it on through `ctx`.
- `packages/sdk/src/host/spawn.ts`: a `chat/turnComplete` or `chat/turnCancelled` for a session that is in a machine waits for `bringBackOf` and only then `refreshFacts`, since the facts read before the fetch are facts about a branch the machine's commit is not on yet; a session in no machine reads its facts without waiting, so nothing a session on the host does waits on Docker.
- `packages/sdk/src/host/resourcemethods.ts`, not `packages/sdk/src/host/changesets.ts` as this task's *Files* names: `invokeChangesetOperation` is where a changeset's verbs are actually invoked, so the fetch lives there, after the mid-turn check and before the operation runs. `bringBackOf(at.owner)` runs first, and an answer with `waiting` throws `-32011` with `the work of <owner> waits in <ref>: nothing acts on <dir> until it is on the branch`. `-32011` is the protocol's `Conflict` and is held in a `CONFLICT` constant beside `WRITE_MODES` with the reason written out: a changeset was read, something moved underneath it, and the verb the client asked for no longer applies to what it was shown. A rejected `bringBack` is `askedOf`'s log line and the operation goes on, which is the same rule as the turn: what could not be fetched is a fact about one machine. A read of the changeset does not fetch - it runs on every look, and the turn's end has fetched already.
- `packages/computer/src/runtime.ts`: the body of `bringBack` moved into a module-internal `bringBackOfMachine(id)`, so `remove` can run it as well as the port; the port's property is that function. `remove` asks for the work before `rm -f`, and where it throws the removal still goes and the log says `the work of <id> could not be brought back before it went: <message>`. The machine's own volume `ahpd-git-<machine>` is removed after the container, so an `rm -f` that came first is the work thrown away.
- `packages/sdk/test/computer-bringback.test.ts`, six cases against a counting `ComputerPort` and the echo backend: a turn ending asks exactly once; a cancelled turn the same (the backend paced, since one that answers at once is over in the tick the turn started in); before an operation and not for a read, with the order of the three calls `enter box echo:/one`, `bringBack box`, `invoke commit` asserted as the whole point; a `waiting` answer refusing the operation with `-32011` and the ref in the sentence, with the operation never invoked; a session leaving its machine fetching before the port is told it left; and a port that rejects logged with the turn still completing. The name the port is told is the one this host holds the session by, and the cases assert that spelling.
- `packages/computer/test/computer-disposable.test.ts`: the case this task's Validation names, `fetches what a machine committed before the machine goes`. It is a machine a daemon before this one left up - its own git directory, its session gone, nothing in this daemon's life fetching for it - so the removal is the only moment left, and the case asserts the bundle's argv, the `volume rm` that follows, and that the host's branch holds the commit that was only in the volume the removal took away. Run with the call in `remove` disabled it fails (`expected -1 to be greater than or equal to 0`, no bundle at all). The first two versions of it were weaker and were replaced: as a disposal it was satisfied by the leave's own fetch, and as a `release_computer` it could not work at all, because that tool then stopped the machine before removing it and `docker exec` into a stopped container is refused - fixed in the review round below, where the tool gets a real-Docker case of its own.
- The same file gained `advanceUntil(check)`: a disposable machine's delay is armed by `leave`, which now asks the machine for its work first, and that is a real subprocess which a clock faked with `vi.useFakeTimers` has no say over. A single `advanceTimersByTimeAsync(1000)` therefore landed before the timer existed and the `until` after it waited five seconds for a removal that was never scheduled; nine cases in the file were failing that way. The helper spends real milliseconds and clock together until the check holds, and the nine now pass.
- `npx tsc -b` clean; `pnpm boundary` reports nothing undeclared; `npx vitest run --no-file-parallelism packages/computer` passes 362 of 362; `npx vitest run --no-file-parallelism packages/sdk` passes 1505 of 1505.
- **Review round** 2026-10-06: `release_computer` no longer loses a machine's commits. It stopped the machine before `remove`, and `docker exec` into a stopped container is refused, so the fetch `remove` runs could not run at all and the volume holding the commits went with the container - a machine's work thrown away quietly, and the tool could not be given a case while it was so. `packages/computer/src/tools.ts` now calls `runtime.remove` with no stop in front of it (`docker rm -f` stops it anyway), with a comment saying why the missing stop is not an oversight. `computer.test.ts` asserts that the removal happens and that nothing stops the machine first, and a new real-Docker case in `computer-git-fetch.test.ts`, `releases a machine with the fetch that brings its commit to the host`, runs the tool over a machine that has committed and reads that commit off the host. The `deferred.md` row this task recorded is removed.
