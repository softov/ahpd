---
title: An answer given the moment a cofold request opens reaches the run
domain: plugin
status: built
priority: high
created: 2026-09-28
revalidated: 2026-09-28
requires:
  - plans/plugin/03-agent-cofold/plan.md
refs:
  - "[code://packages/agent-cofold/src/session.ts#L571-L583](../../../../packages/agent-cofold/src/session.ts#L571-L583) - `paused` is set only when the awaiting `run.finished` is read"
  - "[code://packages/agent-cofold/src/session.ts#L641-L666](../../../../packages/agent-cofold/src/session.ts#L641-L666) - `route`: with `paused` unset the command goes to the run handle, and a refusal is swallowed"
  - "[code://packages/agent-cofold/src/session.ts#L673-L693](../../../../packages/agent-cofold/src/session.ts#L673-L693) - `stopNow`: with `paused` unset it cancels a run that has already settled"
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L43-L46](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L43-L46) - `settle`, the fixed wait that hides the race"
  - npm://@cofold/agents@0.1.2 - `dist/run/turn.js` `pause()` emits `approval.requested`, awaits the run update, then emits `run.paused` and `run.finished`; `dist/run/handle.js` `submit` throws `not_found` when the run has no live request
---

## Goal

A client that answers or cancels as soon as `session/inputNeededSet` arrives has its answer reach the run, and the turn ends.
Today an answer that lands between cofold's `approval.requested` and its awaiting `run.finished` is lost and the turn never ends.

## Reconnaissance

The files read are the `refs` above.

### Runtime path

```
cofold pause(): emit approval.requested -> ahpd session/inputNeededSet -> client answers
  -> route(): paused undefined -> handle.submit -> not_found, swallowed -> answer lost
cofold pause() continues: runs.update awaiting -> run.paused -> run.finished awaiting -> paused set, nobody answers
```

### Gaps

- A confirm, an answer or a decline in that window is dropped; the pending entry is already gone.
- A cancel in that window aborts a run that has already settled, so the turn never ends.
- With `settle(0)` the declined-edit, cancelled-edit and shell-ask cases in `agent-cofold-tools.test.ts` fail every run; with `settle(20)` they fail 21 of 24 on 2 CPUs.

## Decisions locked in

No decision records of its own; the choices below are scope.

| What | Source | Task |
| --- | --- | --- |
| Fixed in ahpd before 0.8.0, not in cofold's emit order | Softov, 2026-09-28, asked "The agent-cofold race is a real daemon bug (a fast answer to an approval is lost and the turn hangs). How do we handle it for 0.8.0?": "Fix it before 0.8.0" | 01 |
| An answer or cancel for an open request that arrives before the pause is recorded waits for the run's awaiting `run.finished`, then goes through `rejoin` like any answer to a paused run | Same answer; the option read "an answer or cancel that arrives while a request is open but the run has not paused yet waits for the pause, then goes to the rejoined run" | 01 |

## Proposed architecture

- **Data flow** - `route` and `stopNow` see a request opened on the current run while `paused` is unset, and hold the command on a promise the awaiting `run.finished` resolves; a run that ends any other way drops what was held, since the ending already settled the request.
- **Layer responsibilities** - agent-cofold only; the SDK, the host and cofold are unchanged.
- **Source-of-truth files** - [`code://packages/agent-cofold/src/session.ts`](../../../../packages/agent-cofold/src/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An early answer waits for the pause](task-01-an-early-answer-waits-for-the-pause.md) | done | - |

## Risks and tradeoffs

- A run with a live request, which takes commands on its handle, must still get its command directly; only the window before a pause waits.

## Resume state

- **Done so far:** every task done 2026-09-28 (`518f438`), approved by Softov; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** the worktree also holds the test-only flake fixes for computer, agent-acp and agent-cofold-store; leave them as they are.

## Final verification checklist

- [ ] `agent-cofold-tools.test.ts` passes with `settle` removed from the answer and cancel cases.
- [ ] A case answers synchronously inside the `session/inputNeededSet` emit, and the turn completes.
- [ ] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
