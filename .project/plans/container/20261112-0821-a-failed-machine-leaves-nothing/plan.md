---
title: A failed machine leaves nothing
domain: container
status: planned
priority: medium
created: 2026-11-12
revalidated: 2026-11-12
requires: []
changes: []
creates: []
refs:
  - git://b4ad32951 - the commit of ahpd this plan was checked at
  - "[code://packages/computer/src/runtime.ts#L3326-L3335](../../../../packages/computer/src/runtime.ts#L3326-L3335) - `docker run` or `create`, `cp`, `start`, then `seedGit`, with no cleanup when one fails"
  - "[code://packages/computer/src/runtime.ts#L2364-L2366](../../../../packages/computer/src/runtime.ts#L2364-L2366) - a failed seed removes the container and not its git volume"
  - "[code://packages/computer/src/runtime.ts#L3391](../../../../packages/computer/src/runtime.ts#L3391) - `remove` drops the git volume: the call to reuse"
  - "[code://packages/computer/src/gitdir.ts#L87](../../../../packages/computer/src/gitdir.ts#L87) - `gitVolumeOf`, the volume's name"
  - "[code://packages/computer/src/plugin.ts#L1543-L1549](../../../../packages/computer/src/plugin.ts#L1543-L1549) - `adopt` leaves this daemon's disposable machine alone when its session is not kept"
  - "[code://packages/computer/src/plugin.ts#L2279](../../../../packages/computer/src/plugin.ts#L2279) - `watch` arms removal only after `run` returned"
  - "[code://packages/computer/src/runtime.ts#L1145](../../../../packages/computer/src/runtime.ts#L1145) - `MACHINE_HOST`, the `ahpd.host` label that says a machine is this daemon's"
---

## Goal

A disposable machine whose create fails leaves no container and no `ahpd-git-<name>` volume.
At start, ahpd removes its own disposable machines whose session it does not keep.
On the Windows check, three containers and six volumes stayed this way.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "volume', 'rm'" packages/computer/src` - only `remove` and the part-volume sweep drop a volume.
- `.project/problems/a-disposed-session-not-held-leaves-its-machine.md` - a related leak on another path, not covered here.

### Runtime path

```
plugin create -> runtime run -> docker run -> seedGit -> (failure) -> error to the session, container and volume stay
start -> adopt -> "left the disposable machine alone"
```

### Gaps

- No catch around `docker run` and its next steps.
- `adopt` has no branch for this daemon's machine of a session it does not keep.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Any failure after `docker run` or `create` removes the container and its git volume | Softov, 2026-11-12: "Clean on failure + at start" | 01 |
| At start, a disposable machine labelled with this daemon's `ahpd.host` whose session is not kept is removed | Softov, 2026-11-12: "Clean on failure + at start" | 02 |
| A machine of another daemon is still left alone | [code://packages/computer/src/plugin.ts#L1543-L1549](../../../../packages/computer/src/plugin.ts#L1543-L1549) | 02 |

## Proposed architecture

- **Data flow** - `run` catches a failure after the container exists, calls `remove`'s cleanup, and throws the first error again.
- **Layer responsibilities** - computer only.
- **Source-of-truth files** - [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts), [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A failed run removes its machine](task-01-a-failed-run-removes-its-machine.md) | implemented | - |
| [02 - Start removes unkept machines](task-02-start-removes-unkept-machines.md) | implemented | - |

## Risks and tradeoffs

- A machine whose session is kept by a daemon that has not started yet looks unkept - the `ahpd.host` label limits removal to this daemon's machines.
- The cleanup can fail too - it is logged, and the first error is the one thrown.

## Resume state

- **Done so far:** both tasks are implemented. The run guard and `cleanUpFailed` are in `runtime.ts`, and `adopt` removes this daemon's unkept disposable machine in `plugin.ts`. The tests are written in `computer-cleanup.test.ts` and `computer-disposable.test.ts`. `pnpm exec tsc -p tsconfig.json --noEmit` prints nothing and no vitest was run.
- **Next action:** review and merge the PR, then the [Windows check](../../../pending/windows-machine-paths-checks.md). The plan closes as `built` on Softov's word.
- **Open questions:** none.
- **Watch out for:** a failed `docker run` can still have made the container, in the `Created` state. The dev container's `seedGit` is the seed's second caller, so it has its own cleanup. In `adopt`, `mine` is true when both the machine and the daemon have no host label.

## Final verification checklist

- [ ] A `docker run` that fails leaves no container and no git volume.
- [ ] A seed that fails leaves no git volume.
- [ ] A restart removes this daemon's disposable machine of a session it does not keep, and leaves another daemon's.
