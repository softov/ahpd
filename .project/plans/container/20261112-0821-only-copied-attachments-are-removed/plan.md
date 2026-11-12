---
title: Only copied attachments are removed from a machine
domain: container
status: planned
priority: low
created: 2026-11-12
revalidated: 2026-11-12
requires: []
changes: []
creates: []
refs:
  - git://b4ad32951 - the commit of ahpd this plan was checked at
  - "[code://packages/sdk/src/host/machines.ts#L210-L219](../../../../packages/sdk/src/host/machines.ts#L210-L219) - `putIn`, which copies attachments into the machine and keeps no record of them"
  - "[code://packages/sdk/src/host/machines.ts#L229-L232](../../../../packages/sdk/src/host/machines.ts#L229-L232) - `takeOut`, which always names the session's whole attachments folder"
  - "[code://packages/sdk/src/host/lifecycle.ts#L496-L516](../../../../packages/sdk/src/host/lifecycle.ts#L496-L516) - teardown calls `takeOut`, then `leave`"
  - "[code://packages/sdk/src/types/computers.ts#L440-L462](../../../../packages/sdk/src/types/computers.ts#L440-L462) - the port's `putIn` and `takeOut`"
  - "[code://packages/computer/src/runtime.ts#L3437-L3440](../../../../packages/computer/src/runtime.ts#L3437-L3440) - the `rm -rf` in the machine"
---

## Goal

A session's removal takes out of its machine only the attachments that were copied in.
Today every session that entered a machine gets an `rm -rf` of the host's attachments path in the machine.
That runs when nothing was copied, and when the disposable machine is removed right after.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- Docker's events on the Windows check: `rm -rf /c/Users/<user>/.../sessions/attachments/<id>` at `session rm`, with no attachment sent.

### Runtime path

```
removeSession -> teardown -> takeOut(machine, uri) -> computers.takeOut -> docker exec rm -rf
```

### Gaps

- `machines.ts` keeps no record of what `putIn` copied.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The host keeps the paths `putIn` copied per session, and `takeOut` removes only those | Softov, 2026-11-12: "Only remove what was copied" | 01 |
| No `takeOut` for a disposable machine that leaves with its last session | Softov, 2026-11-12: "Only remove what was copied" | 01 |
| The copy keeps its host-shaped path in the machine | Softov, 2026-11-12, who chose this over a machine attachments folder | - |

## Proposed architecture

- **Data flow** - `putIn` adds each copied path to a per-session set; `takeOut` sends that set and forgets it.
- **Layer responsibilities** - sdk only.
- **Source-of-truth files** - [`code://packages/sdk/src/host/machines.ts`](../../../../packages/sdk/src/host/machines.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - takeOut names what putIn copied](task-01-takeout-names-what-putin-copied.md) | implemented | - |

## Risks and tradeoffs

- The set lives in memory, so a restart forgets it - a kept machine then keeps those copies; they are read-only and inside the machine only.

## Resume state

- **Done so far:** task 01 implemented. [implemented.md](implemented.md) says what exists, what was checked and where the work left the plan.
- **Next action:** review and merge the PR, then the [Windows check](../../../pending/windows-machine-paths-checks.md). The plan closes as `built` on Softov's word.
- **Open questions:** none.
- **Watch out for:** the `leave` after `takeOut` decides the removal. Teardown asks `leavesWith` before it, from the disposable machines the host recorded and the sessions `enteredIn` holds.

## Final verification checklist

- [ ] A session with no attachment makes no `rm` in its machine.
- [ ] A session with attachments in a kept machine removes only those.
- [ ] A disposable machine's last session makes no `rm`.
