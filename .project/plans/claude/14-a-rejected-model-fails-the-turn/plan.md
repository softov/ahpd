---
title: A model the CLI rejects fails the turn that asked for it
domain: claude
status: planned
priority: high
created: 2026-10-02
revalidated: 2026-10-02
requires:
  - plans/claude/13-a-claude-harness-offers-the-models-it-is-told/plan.md
decisions: []
refs:
  - "[code://packages/agent-claude/src/session.ts#L2354-L2357](../../../../packages/agent-claude/src/session.ts#L2354-L2357) - `beginTurn` sets `chosen` and drops `setModel`'s rejection"
  - "[code://packages/agent-claude/src/session.ts#L2380](../../../../packages/agent-claude/src/session.ts#L2380) - the turn's `message.model`, built from `chosen`"
  - "[code://packages/agent-claude/src/session.ts#L3104](../../../../packages/agent-claude/src/session.ts#L3104) - `setConfig`'s model path, which already reports a refusal"
---

## Goal

A turn that names a model the CLI will not take ends with an error naming the model and the CLI's reason, nothing is sent, and the session stays on the model it was on.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| A rejected model fails the turn rather than running it on the current model | Softov, 2026-10-02, asked "When a turn asks for a model the CLI rejects, what should the harness do?": "Fail the turn" | 01 |
| `chosen` moves only when `setModel` resolves | (found 2026-10-02: a turn asking for `claude-2.1` was labelled `claude-2.1` and answered by `stealth/space-bunny-alpha`; the CLI said `Model 'claude-2.1' not found`) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The turn waits for the model switch](task-01-turn-waits-for-the-switch.md) | todo | - |

## Resume state

- **Done so far:** nothing.
- **Next action:** task 01.
- **Open questions:** none.

## Final verification checklist

- [ ] A turn naming a rejected model ends in error with the CLI's reason, and the next turn runs on the previous model.
- [ ] A turn naming an accepted model runs on it, as today.
- [ ] `plans/index.md` updated.
