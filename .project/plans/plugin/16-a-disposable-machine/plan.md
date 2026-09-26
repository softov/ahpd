---
title: A disposable machine is made for a session and goes after it
domain: plugin
status: planned
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/plugin/15-an-agent-says-what-a-machine-needs/plan.md
changes: []
creates: []
decisions:
  - decisions/the-host-hands-an-agents-machine-needs-to-the-machine-maker.md
refs:
  - "[code://packages/computer/src/plugin.ts#L297-L321](../../../../packages/computer/src/plugin.ts#L297-L321) - the picker a disposable row joins"
  - "[code://packages/sdk/src/types/computers.ts#L47-L49](../../../../packages/sdk/src/types/computers.ts#L47-L49) - the port a session-time create goes through"
  - "[code://.project/ideas/an-agent-says-what-a-machine-needs.md](../../../ideas/an-agent-says-what-a-machine-needs.md) - \"Disposable machines\", as Softov settled them"
---

## Goal

A profile marked `disposable` is offered in the picker as `disposable: <profile>`, a machine is made from it when the session starts with that harness's needs, and it is removed a set time after the last session using it is gone.

## Reconnaissance

### Runtime path

```
picker -> [new] disposable:<profile> rows -> session starts -> [new] host creates with profile + agent.machine() + folder
last session disposed -> [new] timer disposableDelay -> remove; a session that picks it meanwhile cancels the timer
```

### Gaps

- Nothing makes a machine at session start.
- Nothing tracks which sessions use a machine.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [The host hands an agent's machine needs to the plugin that makes the machine](../../../decisions/the-host-hands-an-agents-machine-needs-to-the-machine-maker.md) | 02 |

| What | Source | Task |
| --- | --- | --- |
| `disposable: true` on a profile; the row is `disposable: <profile>` | Softov, 2026-09-26 | 01 |
| Made at session start, with that harness's needs; the profile names no agents | Softov, 2026-09-26 | 02 |
| `disposableDelay` after the last session is disposed; picking it cancels the timer | Softov, 2026-09-26 | 03 |
| `disposableAlone: true` keeps it out of the picker, for its one session | Softov, 2026-09-26 | 03 |
| A restart before the first turn (`host/18`) keeps the machine | Softov, 2026-09-26 | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A disposable profile is offered in the picker](task-01-offered-in-the-picker.md) | todo | - |
| [02 - The machine is made when the session starts](task-02-made-at-session-start.md) | todo | 01 |
| [03 - It goes after the last session, unless picked again](task-03-it-goes-after-the-last-session.md) | todo | 02 |
| [04 - Docs](task-04-docs.md) | todo | 03 |

## Risks and tradeoffs

- A daemon restart loses the timers; machines left behind are found by label at startup and given the delay again.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-offered-in-the-picker.md](task-01-offered-in-the-picker.md).
- **Open questions:** none.
- **Watch out for:** a session that restarts before its first turn must not start the removal timer.

## Final verification checklist

- [ ] Picking `disposable: claude` starts a Claude session in a new machine.
- [ ] The machine is removed `disposableDelay` after its last session is disposed, and survives if another session picks it first.
- [ ] `disposableAlone` rows never appear for a second session.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/COMPUTER.md`, `plans/index.md` updated.
