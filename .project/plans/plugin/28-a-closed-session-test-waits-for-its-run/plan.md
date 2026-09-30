---
title: A test that ends a session waits for its cleanup to finish before removing its folder
domain: plugin
status: built
priority: high
created: 2026-09-29
revalidated: 2026-09-29
requires:
  - plans/plugin/27-an-early-answer-reaches-the-paused-run/plan.md
refs:
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L466-L482](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L466-L482) - closes on the ask and removes the folder at once"
  - "[code://packages/agent-cofold/src/session.ts#L1556-L1559](../../../../packages/agent-cofold/src/session.ts#L1556-L1559) - `close` stops without waiting"
  - https://github.com/softov/ahpd/actions/runs/36566981999 - CI on `c5dbe8c`, `ENOTEMPTY ... rmdir .../sessions/tools/runs/<id>`
---

## Goal

The agent-cofold tests that close a session while its run is paused wait until the stored run has finished before they remove the store, so CI does not fail on `ENOTEMPTY`.

## Reconnaissance

### Runtime path

```
session/inputNeededSet (held before cofold records the pause) -> test: close() -> stop: waits for the owed pause, rejoins, cancels (writes)
test: rmSync(store) runs while cofold still writes runs/<id> -> ENOTEMPTY
```

### Gaps

- `sdk/test/worktrees.test.ts` `takes a clean worktree away with the session` waits for the folder only; git still writes `.git` after it (L535).
- Three cases close and remove at once: `asks before a shell command and sends its bare command on the request` (L466), the case at L362 and the helper path at L701.

## Decisions locked in

No decision records of its own; the choices below are scope.

| What | Source | Task |
| --- | --- | --- |
| Test-only: each case waits, with a wall-clock limit that fails on its own message, until the store holds no run still `running` or `awaiting`, then removes the folder; no retries on the removal | CI red on `c5dbe8c`, 2026-09-29, reported by Softov | 01 |
| Test-only, same shape: a worktree case waits until git lists one worktree and the session's branch is gone before `afterEach` removes the root | `ENOTEMPTY` on `/tmp/ahpd-wt-*` in the review gates, 1 run in 3, 2026-09-29 | 02 |
| Test-only, same shape: the dev container case waits for what still writes into its folder before `afterEach` removes it | `ENOTEMPTY` on `/tmp/ahpd-computer-devc-*`, 1 run in 12 of the file on main `cbaeb10`, 2026-09-29 | 03 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Wait for the run before removing the store](task-01-wait-for-the-run.md) | done | - |
| [02 - Wait for git to finish removing a worktree before removing the repository](task-02-wait-for-git-after-dispose.md) | done | - |
| [03 - The dev container cases wait for what they started](task-03-wait-for-the-dev-container-case.md) | done | - |

## Resume state

- **Done so far:** tasks 01-03 done 2026-09-29; CI green on `944b9cd`.
- **Next action:** none; built.
- **Open questions:** none.
- **Watch out for:** if the run never leaves `awaiting` after `close`, that is a product fault: stop and report it.
