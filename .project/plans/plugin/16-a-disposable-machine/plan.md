---
title: A disposable machine is made for a session and goes after it
domain: plugin
status: built
priority: medium
created: 2026-09-26
revalidated: 2026-10-03
requires:
  - plans/plugin/15-an-agent-says-what-a-machine-needs/plan.md
changes: []
creates: []
decisions:
  - decisions/the-host-hands-an-agents-machine-needs-to-the-machine-maker.md
  - decisions/a-disposable-alone-machine-refuses-another-session.md
  - decisions/a-machine-made-for-a-session-counts-against-max-and-needs-computer-write.md
  - decisions/a-session-folder-reaches-a-machine-only-where-its-profile-allows.md
  - decisions/a-daemon-adopts-only-the-disposable-machines-whose-session-it-keeps.md
  - decisions/a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time.md
refs:
  - "[code://packages/computer/src/plugin.ts#L103-L141](../../../../packages/computer/src/plugin.ts#L103-L141) - `profilesOf`, where the disposable fields are read"
  - "[code://packages/computer/src/plugin.ts#L464-L536](../../../../packages/computer/src/plugin.ts#L464-L536) - `disposables`, `arm`, `watch` and the startup listing"
  - "[code://packages/computer/src/plugin.ts#L663-L801](../../../../packages/computer/src/plugin.ts#L663-L801) - the port's `create`, `enter` and `leave`"
  - "[code://packages/computer/src/plugin.ts#L903-L970](../../../../packages/computer/src/plugin.ts#L903-L970) - the picker a disposable row joins"
  - "[code://packages/sdk/src/types/computers.ts#L118-L178](../../../../packages/sdk/src/types/computers.ts#L118-L178) - the port a session-time create goes through"
  - "[code://packages/sdk/src/computers.ts#L69-L84](../../../../packages/sdk/src/computers.ts#L69-L84) - `openComputer`, the one session-time create"
  - "[code://packages/sdk/src/host.ts#L5304-L5334](../../../../packages/sdk/src/host.ts#L5304-L5334) - `placedIn` and `sessionMachines`"
  - "[code://packages/sdk/src/host.ts#L3596-L3680](../../../../packages/sdk/src/host.ts#L3596-L3680) - `spawn`, the one function every road to a running backend calls"
  - "[code://packages/sdk/src/host.ts#L4589-L4605](../../../../packages/sdk/src/host.ts#L4589-L4605) - `checked`, the `policy/01` check, inert with no principal"
  - "[code://packages/sdk/src/host.ts#L4525-L4526](../../../../packages/sdk/src/host.ts#L4525-L4526) - `principalFor`, the person an owner names when this process met them"
  - "[code://packages/sdk/src/host.ts#L4221](../../../../packages/sdk/src/host.ts#L4221) - `kept.prune`, where a stored session goes after a full listing"
  - "[code://packages/computer/src/runtime.ts#L389-L423](../../../../packages/computer/src/runtime.ts#L389-L423) - the label constants"
  - "[code://docs/COMPUTER.md#L226-L256](../../../../docs/COMPUTER.md#L226-L256) - the disposable section"
  - "git://7552054:.project/ideas/an-agent-says-what-a-machine-needs.md - \"Disposable machines\", as Softov settled them"
---

## Goal

A profile marked `disposable` is offered in the picker as `disposable: <profile>`, a machine is made from it when the session starts with that harness's needs, and it is removed a set time after the last session using it is gone.
Every road that starts a session in it counts that session, a move away lets it go, a daemon keeps only its own leftovers, and a machine made this way is held to `max`, `computer:write` and the profile's `sessionFolder` flag.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Runtime path

```
picker -> disposable:<profile> rows -> createSession / pre-turn restart / automation
  -> [new] computer:write and max checked -> placedIn -> port.create(profile + agent.machine() + [new] folder only with sessionFolder)
  -> label ahpd.disposable=<profile>, [new] ahpd.session=<uri> -> spawn -> [new] enter on every road
session disposed or moved away -> [new] leave the machine it entered -> timer disposableDelay -> rm
daemon start -> list -> [new] adopt only machines whose session this host keeps, counted; open their up-time stretch
another session names an alone machine -> [new] refused
```

### Gaps

- Dispose leaves the machine the session's config names now, so a session that moved off its machine before the first turn never leaves it; `restart` never calls `leave`.
- A session resumed from the list (`host.ts:10143`) is started without `enter`, so its machine is removed under it.
- The startup listing arms every labelled leftover and opens an up-time stretch for every running machine, so two daemons on one Docker remove and charge each other's machines.
- `disposableAlone` is enforced only by the picker.
- A machine made at session start skips `max` and `computer:write`.
- The session's folder is mounted read-write into every disposable machine.

## Decisions locked in

| Decision | Source | Task |
| --- | --- | --- |
| [The host hands an agent's machine needs to the plugin that makes the machine](../../../decisions/the-host-hands-an-agents-machine-needs-to-the-machine-maker.md) | Softov, 2026-09-26 | 02 |
| [A disposableAlone machine refuses every session but the one that made it](../../../decisions/a-disposable-alone-machine-refuses-another-session.md) | Softov, 2026-09-26 | 08 |
| [A machine made for a session counts against max and needs computer:write](../../../decisions/a-machine-made-for-a-session-counts-against-max-and-needs-computer-write.md) | Softov, 2026-09-26 | 09 |
| [A session's folder reaches a machine only where its profile allows it](../../../decisions/a-session-folder-reaches-a-machine-only-where-its-profile-allows.md) | Softov, 2026-09-26 | 10 |
| [A daemon adopts only the disposable machines whose session it keeps](../../../decisions/a-daemon-adopts-only-the-disposable-machines-whose-session-it-keeps.md) | Softov, 2026-09-26 | 07 |
| [A machine is owned by whoever created it, and its owner pays for the time it is up](../../../decisions/a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time.md) | Softov, 2026-10-02 | 07 |

| What | Source | Task |
| --- | --- | --- |
| `disposable: true` on a profile; the row is `disposable: <profile>` | Softov, 2026-09-26 | 01 |
| Made at session start, with that harness's needs; the profile names no agents | Softov, 2026-09-26 | 02 |
| `disposableDelay` after the last session is disposed; picking it cancels the timer | Softov, 2026-09-26 | 03 |
| `disposableAlone: true` keeps it out of the picker, for its one session, and refuses any other session | Softov, 2026-09-26 | 03, 08 |
| Every road that starts a backend in a machine calls `enter`, and a move away calls `leave` for the machine entered | the review of 2026-09-26: a machine leaked on a pre-turn switch and was removed under a resumed session | 05, 06 |
| A restart before the first turn (`host/18`) keeps the machine | Softov, 2026-09-26 | 02 |
| A daemon opens an up-time stretch for a disposable leftover only when it adopts it | follows from the adoption decision: a leftover this daemon does not keep "is not this daemon's, and is left alone" | 07 |
| `computer:write` is the grant check; `policy/01`'s `computer` rows are a separate check and do not replace it | the max/computer:write decision and `policy/01` | 09 |
| The `devcontainer://` road is held to `max` and `computer:write` here, which `container/03` task 12 relies on | the max/computer:write decision: "both sources a session can name" | 09 |
| For now adoption reads `sessionKept` at startup as it is, and the host calls `leave` for the machine a session's stored config names when it forgets or prunes that session, so an adopted leftover goes once its session is pruned; the leave is one host function, so another way to see a gone session can replace it | Softov, 2026-10-03, asked "how does adoption see that a kept session is gone before the store prunes it?": "leave on forget/prune" | 07 |
| For now an automation's start acts as its owner, through `principalFor(owner)`, and is refused a source when that owner has not signed in since the daemon started; the principal is read in one place on that road | Softov, 2026-10-03, asked "which principal does an automation's start act as for `computer:write`?": "its owner via principalFor(owner), refused if the owner has not signed in since start" | 09 |
| For now the `policy/01` check also runs on a pre-turn restart that picks a source and on an automation's start, with the same kinds as `createSession`, through one function the three roads share | Softov, 2026-10-03, asked "does the `policy/01` check also run on a pre-turn restart and an automation's start?": "yes, same kinds" | 09 |
| (defaulted: a daemon has an identity of its own, a random id made once and kept in its config dir at 0600, read after, and named to plugins as `PluginContext.hostId`; it is not a process id, because adoption has to survive a restart. A disposable machine is labelled `ahpd.host=<id>` beside `ahpd.session`, and adoption and `keptFor` place a machine by that label, so a leftover of another daemon is left where it is and is refused to every session here) | the review of 2026-10-03, finding 4: `PluginContext.hostName` is a name, not something unique to a process, and a session id is the client's to choose, so neither can say whose machine it is | 07, 08 |
| (defaulted: `sessionKept` also asks that the session's provider is the URI's own scheme, so a client that opens `echo:/one` over a disposed `acp:/one` does not adopt a leftover made for the other backend) | the review of 2026-10-03, finding 4: the store is keyed by the id inside the URI and two providers share those ids | 07 |
| (defaulted: `ComputerPort.keptFor` answers `{ session, owner, mine }` rather than a session string. `machineRefusal` refuses an owner that differs from the machine's own `ahpd.owner` label, and refuses a machine this daemon did not make before it compares the session at all. An owner on either side is optional: a host with no users directory has no owner to disagree about) | the review of 2026-10-03, finding 4: the refusal compares two strings a client can choose, and the smaller half of it needs the asking session's owner to reach the port | 08 |
| (defaulted: a new session that reuses a disposed session's id from the same owner on the same daemon still reaches that session's old alone machine. The two rules the review offers are not available here: `SessionStore` keeps no creation time to compare the machine against, and `Machine.created` is Docker's display string rather than a timestamp. Closing it needs a per-session nonce on the machine's label, which is a change to the store this plan does not make) | the review of 2026-10-03, finding 4, the "a new session reusing a disposed session's id" case | 08 |

## Proposed architecture

- **State flow** - the host keeps, per session, the machine it entered (`enter` in `spawn`, `leave` at dispose and when a restart moves it), and `sessionMachines` only for a machine made from a source; the plugin keeps the set of sessions per disposable machine; the machine keeps its profile, alone flag and session as labels.
- **Layer responsibilities** - sdk: `enter`/`leave` placement, `leaveForgotten` for a session a listing stops finding, the grant check, `admitted` for the `policy/01` kinds on all three roads, `PluginHost.sessionKept` with the provider asked of it, the daemon's own id in the config dir, the shared machine refusal reader · computer: labels, adoption, `max`, `sessionFolder`, the port's alone answer.
- **Source-of-truth files** - [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/sdk/src/computers.ts`](../../../../packages/sdk/src/computers.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A disposable profile is offered in the picker](task-01-offered-in-the-picker.md) | done | - |
| [02 - The machine is made when the session starts](task-02-made-at-session-start.md) | done | 01 |
| [03 - It goes after the last session, unless picked again](task-03-it-goes-after-the-last-session.md) | done | 02 |
| [04 - Docs](task-04-docs.md) | done | 03 |
| [05 - A machine is left when its session moves away before the first turn](task-05-a-machine-is-left-when-its-session-moves-away.md) | done | - |
| [06 - A resumed session counts as a user](task-06-a-resumed-session-counts-as-a-user.md) | done | 05 |
| [07 - A daemon adopts only its own leftovers](task-07-a-daemon-adopts-only-its-own-leftovers.md) | done | 06, plugin/15 task 08 |
| [08 - A disposable-alone machine refuses another session](task-08-a-disposable-alone-machine-refuses-another-session.md) | done | 07, plugin/15 task 11 |
| [09 - A machine made for a session counts against max and needs computer:write](task-09-a-machine-made-for-a-session-counts.md) | done | - |
| [10 - The session folder needs the profile's flag](task-10-the-session-folder-needs-the-profiles-flag.md) | done | - |
| [11 - Docs and comments](task-11-docs-and-comments.md) | done | 05, 06, 07, 08, 09, 10 |

## Risks and tradeoffs

- A daemon restart loses the timers; a leftover whose session this daemon keeps is adopted with that session counted, and one whose session it does not keep is left alone.
- A leftover whose session was deleted while every daemon was down is adopted by none, so it stays up and no daemon charges its up time; the docs say how to find and remove it by label.
- Two daemons on one Docker still each open a stretch for a shared machine that is not disposable; that is `usage/03`'s meter and outside this plan.
- A profile without `sessionFolder` loses the same-path history until the operator sets the flag, which the docs say.

## Resume state

- **Done so far:** built 2026-10-03, see [implemented.md](implemented.md).

## Final verification checklist

- [x] Picking `disposable: claude` starts a Claude session in a new machine.
- [x] The machine is removed `disposableDelay` after its last session is disposed, and survives if another session picks it first.
- [x] A session that switches away before its first turn lets its machine go after the delay, including when the new source is refused.
- [x] A session resumed from the list after a daemon restart holds its machine until it is disposed.
- [x] A kept session holds its machine across a daemon restart, and a second daemon on the same Docker neither removes it nor opens an up-time stretch for it.
- [x] `disposableAlone` rows never appear for a second session, and a hand-typed id is refused at creation.
- [x] `max` and `computer:write` hold for `disposable:` and `devcontainer://` machines made at session start, on `createSession`, a pre-turn restart and an automation's start, the automation acting as its owner.
- [x] A `policy/01` computer refusal holds on a pre-turn restart that picks a source and on an automation's start, as on `createSession`.
- [x] An adopted leftover goes `disposableDelay` after its session is pruned from the store.
- [x] A profile without `sessionFolder` makes a machine with no session folder.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/COMPUTER.md` updated. (`plans/index.md` was left alone, as the work's own rules say.)
