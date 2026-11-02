---
title: Every turn and steering message a cofold session is handed is answered
domain: cofold
status: built
priority: medium
created: 2026-10-31
revalidated: 2026-10-31
requires:
  - plans/cofold/20261031-1200-a-failed-cofold-turn-is-resumed/plan.md
refs:
  - git://47d14247 - the commit of ahpd this plan was checked at
  - "[code://packages/agent-cofold/src/turns.ts#L520-L556](../../../../packages/agent-cofold/src/turns.ts#L520-L556) - `beginTurn`, which waits on `ctx.opening` and then opens the turn"
  - "[code://packages/agent-cofold/src/turns.ts#L159-L167](../../../../packages/agent-cofold/src/turns.ts#L159-L167) - `openTurn`, which answers nothing while a turn is active"
  - "[code://packages/agent-cofold/src/turns.ts#L559-L591](../../../../packages/agent-cofold/src/turns.ts#L559-L591) - `startNext`, which takes the head of the queue once the chat is idle"
  - "[code://packages/agent-cofold/src/session.ts#L236-L247](../../../../packages/agent-cofold/src/session.ts#L236-L247) - the opening a resume, a fork or a rewind sets"
  - "[code://packages/agent-cofold/src/runs.ts#L203-L250](../../../../packages/agent-cofold/src/runs.ts#L203-L250) - `reopen`, which makes a paused run the active turn"
  - "[code://packages/agent-cofold/src/runs.ts#L154](../../../../packages/agent-cofold/src/runs.ts#L154) - the turn's end starts the next one, except after a cancel"
  - "[code://packages/agent-cofold/src/session.ts#L361-L386](../../../../packages/agent-cofold/src/session.ts#L361-L386) - `steer`, which hands the message to the run and says nothing"
  - "[code://packages/agent-cofold/src/session.ts#L316-L328](../../../../packages/agent-cofold/src/session.ts#L316-L328) - `chatState`, with no steering message"
  - "[code://packages/sdk/src/types/agent.ts#L441-L452](../../../../packages/sdk/src/types/agent.ts#L441-L452) - `Start.handed`, the client's action a backend answers later"
  - "[code://packages/agent-claude/src/session/turns.ts#L595-L607](../../../../packages/agent-claude/src/session/turns.ts#L595-L607) - Claude refuses a turn it cannot begin through `handed`, with 'A turn is running in this chat'"
  - "[code://packages/agent-claude/src/session/turns.ts#L536-L562](../../../../packages/agent-claude/src/session/turns.ts#L536-L562) - Claude's turn of its own for a steering message its turn never took in"
  - "[code://packages/agent-pi/src/session.ts#L1370-L1418](../../../../packages/agent-pi/src/session.ts#L1370-L1418) - pi says a steering message inside the dispatch, holds it, and takes it out once pi has read it"
  - "npm://@cofold/agents@0.4.0 - `RunHandle.submit({ type: 'steer' })` settles once the message is in the transcript and rejects `not_running` when the run settles first (run/handle.js, run/steering.js, decision 95); `finishRun` says `run.finished` before `settle` rejects the steers left"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md - a client holds its action until an envelope with its own origin, or a rejection, answers it"
  - "https://github.com/microsoft/agent-host-protocol/blob/main/docs/specification/chat-channel.md#steering-messages - consumption is `chat/pendingMessageRemoved` with the id and kind `steering`, or `chat/turnStarted` naming it as a turn of its own; pending steering is retained while idle"
---

## Goal

A turn or a steering message a client hands a cofold session is answered to that client.
A turn that waited on the session's opening and finds a turn running once it has opened is refused with the sentence the host gives for the same case.
A steering message is said as the chat's steering message inside the dispatch, taken out once the run has read it, and run as a turn of its own when the run it went into never did.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "opening" packages/agent-cofold/src` - a resume, a fork and a rewind set `ctx.opening`; every turn handed meanwhile waits on it, and the first to open makes the rest find a turn active.
- `rg -n "ctx.active = " packages/agent-cofold/src/runs.ts` - `reopen` makes a paused run the active turn, so the client's first turn after a resume of a paused conversation finds it running.
- `rg -n "steer" packages/agent-cofold/src` - `steer` submits and returns; `mapping.ts` drops `run.steered`; nothing says the message or takes it out.
- `rg -n "rejectSteering|run.finished" node_modules/@cofold/agents/dist/run` - the steers a run never drained are rejected after `run.finished`.

### Gaps

- A second turn handed while the session opens, and a first turn handed while a resumed paused run reopens, return at `openTurn` with nothing said (audit E5's cofold half, E6).
- A steering message gets no answer, no entry in the chat's state, and no removal once read (audit E10's cofold half).

## Answers

| What | Source | Task |
| --- | --- | --- |
| A turn that cannot begin once the opening settles is refused through `handed` with 'A turn is running in this chat' | Claude's E5 fix; the host's own guard says the same sentence | 01 |
| A steering message is said and held inside the dispatch, and taken out once in the transcript | pi's steer; cofold's `submit` settles once the message is in the transcript | 02 |
| A steering message the run never took in runs as a turn of its own, named by `queuedMessageId`, once the chat is idle, and after a stopped turn it waits as the queue does | Claude's turn of its own for one; the spec's consumption as a turn; runs.ts starts nothing after a cancel | 02 |

## Proposed architecture

- **Event flow** - a turn handed during the opening keeps its `handed` from `beginTurn`, and refuses through it when it finds a turn active; a steer says `chat/pendingMessageSet` inside the dispatch, then `chat/pendingMessageRemoved` when cofold's submit settles, or a turn of its own from `startNext` when it rejects.
- **Layer responsibilities** - the cofold backend: answering what it was handed.
- **Source-of-truth files** - [`code://packages/agent-cofold/src/turns.ts`](../../../../packages/agent-cofold/src/turns.ts), [`code://packages/agent-cofold/src/session.ts`](../../../../packages/agent-cofold/src/session.ts), [`code://packages/agent-cofold/src/context.ts`](../../../../packages/agent-cofold/src/context.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A turn that cannot begin once the session has opened is refused](task-01-a-turn-that-cannot-begin-is-refused.md) | done | - |
| [02 - A steering message is answered, held and taken out](task-02-a-steering-message-is-answered.md) | done | - |

## Risks and tradeoffs

- A steering message left after a stopped turn waits until the chat next starts something, as a queued message does, and stays in the chat's state meanwhile.

## Resume state

- **Done so far:** planned and built 2026-10-31. See [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** `handed` is read inside the dispatch, at the top of `beginTurn`; read after the wait it answers nothing.

## Final verification checklist

- [x] Each new case fails on `47d14247` for the reason it names, and passes after the change.
- [x] The touched suites pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors.
