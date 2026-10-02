---
title: A session and an automation say who owns them, and a turn says who sent it
domain: host
status: planned
priority: high
created: 2026-10-01
revalidated: 2026-10-01
requires: []
decisions:
  - decisions/work-is-owned-by-a-typed-reference.md
refs:
  - "[code://packages/sdk/src/host.ts#L7853](../../../../packages/sdk/src/host.ts#L7853) - `createSession` opens the session with no principal"
  - "[code://packages/sdk/src/sessions.ts#L80-L91](../../../../packages/sdk/src/sessions.ts#L80-L91) - `Saved`, the persisted session fields; unknown keys are ignored on load"
  - "[code://packages/sdk/src/types/automations.ts#L14-L29](../../../../packages/sdk/src/types/automations.ts#L14-L29) - `Automation`, no creator"
  - "[code://packages/sdk/src/host.ts#L7409-L7413](../../../../packages/sdk/src/host.ts#L7409-L7413) - a manual run's origin \"carries no room for who asked\""
  - "[code://packages/sdk/src/types/users.ts#L40-L102](../../../../packages/sdk/src/types/users.ts#L40-L102) - `Principal`, per connection"
---

## Goal

A session records, across restarts, who owns it; every turn knows the person who sent it; an automation records who created it and its runs carry that.
This is what lets usage be attributed to a person, and later to a team or a project.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Runtime path

```
connection.principal -> createSession -> session owner (persisted) ; sendMessage -> turn sender -> emit -> (later) usage record
```

### Gaps

- The principal dies at the connection; no session, turn or run keeps it.
- `Automation` has no creator field.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [Work is owned by a typed reference, user, team or project](../../../decisions/work-is-owned-by-a-typed-reference.md) | Softov, 2026-10-01 |

| What | Source | Task |
| --- | --- | --- |
| A turn carries the person who sent it; a turn an automation started carries the automation's creator | Softov, 2026-09-30, in [host 33](../33-a-session-tool-acts-as-the-person-it-works-for/plan.md): "Who sent the turn" | 02, 03 |
| A host with no users directory records no owner | (defaulted: there is no person to record) | 01 |
| A root connection records `root:<host>` as owner | Softov, 2026-10-01, asked the root owner's spelling: "root:<host>" | 01 |
| `<host>` is `HostOptions.hostName`, which the daemon sets from the machine's hostname | (defaulted: the sdk has no name for its host today) | 01 |
| A session's scope is resolved against its owner | host 35 review, finding left for this plan | 01 |

## Proposed architecture

- **Data flow** - the principal of the asking connection becomes the session's `owner` (`user:<id>`) and the active turn's `sender`.
- **State flow** - `owner` is persisted with the session; `sender` lives with the turn in memory and reaches usage records later.
- **Layer responsibilities** - `packages/sdk`: all of it.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/sdk/src/sessions.ts`](../../../../packages/sdk/src/sessions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A session records its owner](task-01-session-owner.md) | todo | - |
| [02 - A turn knows who sent it](task-02-turn-sender.md) | todo | - |
| [03 - An automation records its creator, and a run carries it](task-03-automation-owner.md) | todo | - |

## Risks and tradeoffs

- [host 32](../32-the-session-store-is-a-file-per-session/plan.md) reshapes the session store; whichever lands second carries `owner` into the other's shape.
- [host 33](../33-a-session-tool-acts-as-the-person-it-works-for/plan.md) task 01 needs the turn's sender too; task 02 here and that task build the same thing, so whichever lands first builds it.
- The team and project the work is charged to come from [host 35](../35-a-person-belongs-to-teams-and-projects/plan.md), which is better built first so the owner and its scope land together; `team:` and `project:` owners wait for work no person starts.

## Resume state

- **Done so far:** planned 2026-10-01.
- **Next action:** [task-01-session-owner.md](task-01-session-owner.md).
- **Open questions:** none.
- **Watch out for:** the owner is host-side only; the protocol's session state has no field for it.

## Final verification checklist

- [ ] A session created by a signed-in person still names them as owner after a daemon restart.
- [ ] `plans/index.md` updated.
