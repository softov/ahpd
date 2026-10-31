---
title: A turn the Claude session cannot begin is refused
domain: claude
status: planned
priority: medium
created: 2026-10-31
revalidated: 2026-10-31
refs:
  - git://cae062e6 - the commit of ahpd this plan was checked at
  - "[code://packages/agent-claude/src/session/turns.ts#L594-L596](../../../../packages/agent-claude/src/session/turns.ts#L594-L596) - `begin`, which hands every turn to `beginTurn`"
  - "[code://packages/agent-claude/src/session/turns.ts#L203-L212](../../../../packages/agent-claude/src/session/turns.ts#L203-L212) - `beginTurn` returns with nothing said for a turn that arrives while one runs or begins"
  - "[code://packages/agent-claude/src/session/turns.ts#L59](../../../../packages/agent-claude/src/session/turns.ts#L59) - `busy`, a turn active or beginning"
  - "[code://packages/agent-claude/src/session/turns.ts#L260-L284](../../../../packages/agent-claude/src/session/turns.ts#L260-L284) - a turn that names another model is `beginning` until the switch answers"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1366](../../../../packages/sdk/src/host/lifecycle.ts#L1366) - the host refuses a turn while the chat state holds an active one, and a beginning turn is in no state"
  - "[code://packages/sdk/src/host/spawn.ts#L1204](../../../../packages/sdk/src/host/spawn.ts#L1204) - `Start.handed`, which finds the client's dispatch an action answers and refuses it to that client"
  - "[code://docs/sdk/AGENT.md#L248](../../../../docs/sdk/AGENT.md#L248) - *Answering later*: a session takes `start.handed(action)` inside the method and refuses through it"
  - "[code://packages/agent-claude/src/claude.ts#L717](../../../../packages/agent-claude/src/claude.ts#L717) - the Claude agent builds its session with `start.emit` and nothing else of what the host hands it"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md#L23-L30 - a client holds its action until an envelope with its own origin, or a rejection, answers it"
---

## Goal

A turn that reaches the Claude session while a turn of that chat runs or is still beginning is refused to the client that sent it, in the words the host gives a turn that arrives while one runs.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "busy\(\)" packages/agent-claude/src` - `begin` does not ask, and `beginTurn` returns on it with nothing said.
- `rg "handed" packages/sdk/src packages/agent-*/src` - the host hands a backend `Start.handed`, and only the nested session takes it.
- `rg "emit: start.emit" packages/agent-claude/src` - the Claude session is built with `emit` and no `handed`.

### Gaps

- A turn that arrives while the turn before it switches its model, or waits on the tools the session was handed, passes the host's check, since the chat state holds no active turn yet, and is dropped by the Claude session: its client holds it as pending, and its own turn replaces the running one in that client's view.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The session refuses the turn through `start.handed`, the way *Answering later* has a session refuse | `docs/sdk/AGENT.md`, the nested session's `carry` | 01 |
| `SessionOptions` carries `handed` beside `emit`, and the Claude agent passes `start.handed` on | `emit` reaches the session the same way | 01 |
| The refusal is the host's sentence for a turn that arrives while one runs | lifecycle.ts, the host's own refusal | 01 |
| `beginTurn` keeps its guard, which keeps `active` for any caller | its own reason: a second turn begun on top of the first takes its place | 01 |

## Proposed architecture

- **Event flow** - `begin` asks `busy()`: a turn running or beginning refuses the new one through `handed`; otherwise the turn begins as before.
- **Layer responsibilities** - `SessionOptions.handed`: what the host hands every session; the Claude session: whether a turn can begin.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A turn the Claude session cannot begin is refused](task-01-a-turn-the-backend-cannot-begin-is-refused.md) | todo | - |

## Risks and tradeoffs

- A turn the host started for itself names no client, so `handed` answers nothing for it and it is dropped as before.

## Resume state

- **Done so far:** planned 2026-10-31.
- **Next action:** [task-01-a-turn-the-backend-cannot-begin-is-refused.md](task-01-a-turn-the-backend-cannot-begin-is-refused.md).
- **Open questions:** none.
- **Watch out for:** cofold drops a turn the same way while it reopens a session; that half waits for the cofold resume plan, which reshapes its turn opening.

## Final verification checklist

- [ ] The new case fails on `cae062e6` for the reason it names, and passes after the change.
- [ ] The touched suites pass.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors.
