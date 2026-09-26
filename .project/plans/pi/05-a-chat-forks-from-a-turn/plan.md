---
title: A pi chat forks from a turn
domain: pi
status: planned
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/pi/01-a-turn-ends-as-it-ended/plan.md
  - plans/host/19-a-fork-copies-through-the-turn/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-pi/src/session.ts#L18-L21](../../../../packages/agent-pi/src/session.ts#L18-L21) - why fork was left out: the entry a turn began at was not recorded"
  - "[code://packages/agent-pi/README.md#L57](../../../../packages/agent-pi/README.md#L57) - the README says the same"
  - "[code://packages/sdk/src/types/session.ts#L230-L242](../../../../packages/sdk/src/types/session.ts#L230-L242) - `forkPoint`, which host 19 redefines as the last entry the turn left behind"
  - "[code://.project/plans/host/19-a-fork-copies-through-the-turn/plan.md](../../../../.project/plans/host/19-a-fork-copies-through-the-turn/plan.md) - the contract change this plan is written to"
  - "[code://packages/sdk/src/types/agent.ts#L274](../../../../packages/sdk/src/types/agent.ts#L274) - `chats.fork`, which the host checks before it asks for a fork point"
  - "[code://packages/sdk/src/host.ts#L6952-L6961](../../../../packages/sdk/src/host.ts#L6952-L6961) - the host's fork: `resume` is the source, `forkAt` the point, `seed` the turns through the chosen one"
  - "[code://packages/agent-pi/src/backend.ts#L98-L107](../../../../packages/agent-pi/src/backend.ts#L98-L107) - `resumeOrCreate`, where the branch is made"
  - "[code://packages/agent-claude/src/claude.ts#L363](../../../../packages/agent-claude/src/claude.ts#L363) - the sibling declares `chats: { fork: true, sideChat: true }`"
  - "[code://packages/agent-cofold/src/session.ts#L180-L226](../../../../packages/agent-cofold/src/session.ts#L180-L226) - the other sibling gives a fork a new id so the source is never appended to, and refuses a fork with no source"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - `SessionManager.createBranchedSession(leafId)` and `getLeafId()` in `dist/core/session-manager.d.ts`; `createBranchedSession` switches the manager to a new session id and file and leaves the source file as it was
---

## Goal

A client can fork a pi chat from one of its turns, and the fork is a new pi session holding the conversation through that turn, answer included, that the source is not touched by.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `sed -n 1201,1290p dist/core/session-manager.js` in pi 0.87.1 - `createBranchedSession` writes the root-to-leaf path under a new id and file, switches the manager to it, and defers the write until an assistant message exists.
- `grep -n "async fork(" dist/core/agent-session-runtime.js` - pi's own fork has two positions: "before" a user message, at its parent, and "at" an entry, keeping it; a fork through the turn is the "at" reading.
- The reason at `session.ts:18-21` is not a pi limitation: pi 0.87.1 can branch from any entry, and what was missing is recording the entry as the turn runs, which is this plan.

### Runtime path

```
agent_settled -> leaf recorded (plan 01 task 01) -> [new] forkPoint(turnId) answers it
client createChat source.kind 'fork' -> host.ts:6952 forkPoint -> create(start with resume, forkAt, seed)
  -> opened() -> openPi -> [new] SessionManager.open(source) then createBranchedSession(forkAt) -> new pi id
```

### Gaps

- No `forkPoint`, no `chats.fork`, and `start.forkAt` is ignored.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Answer `forkPoint(turnId)`, fork with `SessionManager.createBranchedSession`, and declare `chats.fork` | Softov, 2026-09-26: "answer `forkPoint(turnId)`, fork with `SessionManager.createBranchedSession`, and declare `chats.fork`" | 01, 02 |
| A fork copies through the chosen turn: `forkPoint` is the leaf recorded at `agent_settled`, the same entry `endPoint` answers, and not the leaf before the prompt | Softov, 2026-09-26, answering how a fork should cut: "Fork follows the AHP spec: a fork copies history through the chosen turn"; [host 19](../../host/19-a-fork-copies-through-the-turn/plan.md) | 01 |
| The branch is made on the resumed manager before the `AgentSession` is built, so the backend's `id` is the fork's and the source file is never written | pi 0.87.1 `createBranchedSession` switches the manager in place; the sibling's rule that a fork never appends to its source, [`code://packages/agent-cofold/src/session.ts#L180-L189`](../../../../packages/agent-cofold/src/session.ts#L180-L189) | 02 |
| A fork whose `forkAt` pi does not know, or with no `resume`, is refused at open rather than started empty | [`code://packages/agent-cofold/src/session.ts#L213-L220`](../../../../packages/agent-cofold/src/session.ts#L213-L220) | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A turn names where a fork cuts](task-01-a-turn-names-where-a-fork-cuts.md) | todo | - |
| [02 - A fork opens a branched session](task-02-a-fork-opens-a-branched-session.md) | todo | 01 |

## Risks and tradeoffs

- `createBranchedSession` bypasses pi's `session_before_fork` extension hook, which pi's runtime `fork` runs; an extension that vetoes forks is not asked. The brief chose `createBranchedSession`.
- A turn this process did not watch has no recorded leaf, so it offers no fork, as it offers no truncation.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-turn-names-where-a-fork-cuts.md](task-01-a-turn-names-where-a-fork-cuts.md), after host 19 task 01 and plan 01 task 01.
- **Open questions:** none.
- **Watch out for:** a `!command` turn is not pi's and has no fork point; `forkPoint` answers nothing for it.

## Final verification checklist

- [ ] `forkPoint` answers the leaf recorded when the turn settled.
- [ ] A fork through the host opens a new pi session id, the source file is byte-for-byte unchanged, and the fork's context ends with the chosen turn's answer.
- [ ] `README.md` and the `session.ts` header say fork works.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `plans/index.md` updated.
