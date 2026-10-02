---
title: A model pi cannot find fails the turn that asked for it
domain: pi
status: built
priority: high
created: 2026-10-02
revalidated: 2026-10-02
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-pi/src/backend.ts#L254-L270](../../../../packages/agent-pi/src/backend.ts#L254-L270) - `choose`, which returns without a word for an id it cannot resolve"
  - "[code://packages/agent-pi/src/session.ts#L775](../../../../packages/agent-pi/src/session.ts#L775) - the turn labelled with the id it asked for"
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts) - `take` and `refuseTurn`, the same rule on Claude (claude/14)"
---

## Goal

A turn naming a model pi cannot resolve fails with an error naming the model, nothing is prompted, and the session stays on the model it was on; the configured `model` and a rebuilt session's carried model fall back as today.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| A turn's pick pi cannot resolve fails the turn | Softov, 2026-10-02, asked "pi runs a turn on its current model when the picked model can't be resolved. Change that to match Claude?": "Fail the turn" | 01 |
| The configured `model` option still falls back to pi's default when it cannot be resolved | same answer, whose option kept it | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A turn's pick is taken or refused](task-01-a-turns-pick-is-taken-or-refused.md) | done | - |

## Resume state

- **Done so far:** built 2026-10-02; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.

## Final verification checklist

- [x] A turn naming an unknown model ends in error naming it, nothing is prompted, and the next turn runs on the previous model.
- [x] The configured `model` and a rebuilt session's carried model behave as before.
- [x] `plans/index.md` updated. Left to whoever merges: the plan says this worktree does not edit the index.
