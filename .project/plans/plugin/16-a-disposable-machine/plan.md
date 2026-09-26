---
title: A disposable machine is made for a session and goes after it
domain: plugin
status: active
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/plugin/15-an-agent-says-what-a-machine-needs/plan.md
changes: []
creates: []
decisions:
  - decisions/the-host-hands-an-agents-machine-needs-to-the-machine-maker.md
  - decisions/a-daemon-adopts-only-the-disposable-machines-whose-session-it-keeps.md
  - decisions/a-disposable-alone-machine-refuses-another-session.md
  - decisions/a-machine-made-for-a-session-counts-against-max-and-needs-computer-write.md
  - decisions/a-session-folder-reaches-a-machine-only-where-its-profile-allows.md
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
| [A daemon adopts only the disposable machines whose session it keeps](../../../decisions/a-daemon-adopts-only-the-disposable-machines-whose-session-it-keeps.md) | 07 |
| [A disposable-alone machine refuses another session](../../../decisions/a-disposable-alone-machine-refuses-another-session.md) | 08 |
| [A machine made for a session counts against max and needs computer:write](../../../decisions/a-machine-made-for-a-session-counts-against-max-and-needs-computer-write.md) | 09 |
| [A session folder reaches a machine only where its profile allows](../../../decisions/a-session-folder-reaches-a-machine-only-where-its-profile-allows.md) | 10 |

| What | Source | Task |
| --- | --- | --- |
| `disposable: true` on a profile; the row is `disposable: <profile>` | Softov, 2026-09-26 | 01 |
| Made at session start, with that harness's needs; the profile names no agents | Softov, 2026-09-26 | 02 |
| `disposableDelay` after the last session is disposed; picking it cancels the timer | Softov, 2026-09-26 | 03 |
| `disposableAlone: true` keeps it out of the picker, for its one session, and refuses any other session | Softov, 2026-09-26 | 03, 08 |
| Every road that starts a backend in a machine calls `enter`, and a move away calls `leave` for the machine entered | the review of 2026-09-26: a machine leaked on a pre-turn switch and was removed under a resumed session | 05, 06 |
| A restart before the first turn (`host/18`) keeps the machine | Softov, 2026-09-26 | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A disposable profile is offered in the picker](task-01-offered-in-the-picker.md) | implemented | - |
| [02 - The machine is made when the session starts](task-02-made-at-session-start.md) | implemented | 01 |
| [03 - It goes after the last session, unless picked again](task-03-it-goes-after-the-last-session.md) | implemented | 02 |
| [04 - Docs](task-04-docs.md) | implemented | 03 |
| [05 - A machine is left when its session moves away before the first turn](task-05-a-machine-is-left-when-its-session-moves-away.md) | todo | - |
| [06 - A resumed session counts as a user](task-06-a-resumed-session-counts-as-a-user.md) | todo | - |
| [07 - A daemon adopts only its own leftovers](task-07-a-daemon-adopts-only-its-own-leftovers.md) | todo | 06 |
| [08 - A disposable-alone machine refuses another session](task-08-a-disposable-alone-machine-refuses-another-session.md) | todo | 07 |
| [09 - A machine made for a session counts against max and needs computer:write](task-09-a-machine-made-for-a-session-counts.md) | todo | - |
| [10 - The session folder needs the profile's flag](task-10-the-session-folder-needs-the-profiles-flag.md) | todo | - |
| [11 - Docs and comments](task-11-docs-and-comments.md) | todo | 07, 08, 10 |

## Risks and tradeoffs

- A daemon restart loses the timers; machines left behind are found by label at startup and given the delay again.

## Resume state

- **Done so far:** tasks 01 to 04 implemented on 2026-09-26 and reviewed the same day.
- **Next action:** task 05, then 06 and 07; 09 and 10 go in any order.
- **Open questions:** none.
- **Watch out for:** a session that restarts before its first turn must not start the removal timer; the session's `computer` setting is rewritten to `computer://<id>`, a re-sent source is matched through the host's `sessionMachines`, and `enter` is a set rather than a count so a restart cannot look like a second user; plugin/15 task 11 adds a create-time machine check that task 08's refusal joins.

## Final verification checklist

- [ ] Picking `disposable: claude` starts a Claude session in a new machine.
- [ ] The machine is removed `disposableDelay` after its last session is disposed, and survives if another session picks it first.
- [ ] `disposableAlone` rows never appear for a second session, and a hand-typed id is refused.
- [ ] A session that switches away before its first turn lets its machine go after the delay.
- [ ] A kept session holds its machine across a daemon restart, and a second daemon on the same Docker leaves it alone.
- [ ] `max` and `computer:write` hold for a machine made at session start.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/COMPUTER.md`, `plans/index.md` updated.
