---
title: A machine records who created it and writes the time it was up, charged to its owner
domain: usage
status: planned
priority: high
created: 2026-10-02
revalidated: 2026-10-02
requires:
  - plans/usage/01-usage-is-kept-behind-one-port/plan.md
  - plans/host/34-work-says-who-owns-it/plan.md
changes: []
creates: []
decisions:
  - decisions/a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time.md
  - decisions/agent-usage-is-charged-to-owner-team-and-project-pools.md
  - decisions/usage-and-computer-time-are-two-records-behind-one-port.md
refs:
  - "[code://packages/sdk/src/types/computers.ts](../../../../packages/sdk/src/types/computers.ts) - `MachineSource` and `ComputerPort.create`, where the owner is handed over"
  - "[code://packages/sdk/src/types/plugin.ts#L206](../../../../packages/sdk/src/types/plugin.ts#L206) - `registerUsage`; a plugin has no way to write a record yet"
  - "[code://packages/sdk/src/host.ts#L9130](../../../../packages/sdk/src/host.ts#L9130) - a resource create, the direct path a person makes a machine by"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - the machines, their labels and lifecycle"
  - "[code://packages/computer/src/devcontainer.ts](../../../../packages/computer/src/devcontainer.ts) - the dev container runtime, the second maker"
---

## Goal

Each machine the computer plugin makes carries its creator as its owner, and every stretch a machine is up is written as a `ComputerTime` record (`source: 'computer'`) charged to that owner's pool, or to `root:<host>` for a machine with none.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| [The creator owns a machine and pays for its up time](../../../decisions/a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time.md) | Softov, 2026-10-02 | 01, 02 |
| [Pools are owner, team and project](../../../decisions/agent-usage-is-charged-to-owner-team-and-project-pools.md) | Softov, 2026-10-02 | 02 |

| What | Source | Task |
| --- | --- | --- |
| The owner is stored on the machine itself (a label), so it survives a daemon restart | the decision's consequences | 01 |
| A machine made for a session also stores that session's team and project, and its records name them | (defaulted: the work that made it is charged under that scope) | 01, 02 |
| A plugin writes records through a host-provided recorder, not the store itself | (defaulted: the store is the daemon's port; a plugin reports, the host writes) | 02 |
| A stretch is written when it ends: the machine stops, is removed, or the daemon stops; at start the daemon opens a stretch for each running machine from that moment | (defaulted: a crash loses the open stretch, see deferred) | 02 |
| A stretch's `at` is when it began and `seconds` its length; no cost is worked out | prices are usage/05 | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A machine knows who created it](task-01-a-machine-knows-its-creator.md) | todo | - |
| [02 - The computer plugin writes up time](task-02-the-plugin-writes-up-time.md) | todo | 01 |

## Resume state

- **Done so far:** nothing.
- **Next action:** task 01.
- **Open questions:** none.

## Final verification checklist

- [ ] A machine made for a session and one made directly each carry their creator, and keep it across a daemon restart.
- [ ] Start then stop writes one record with the right `seconds`, owner and pools; a daemon stop closes open stretches and a start reopens them.
- [ ] A machine with no owner is charged to `root:<host>`.
- [ ] `usage/00-usage.md` updated; `plans/index.md` updated.
