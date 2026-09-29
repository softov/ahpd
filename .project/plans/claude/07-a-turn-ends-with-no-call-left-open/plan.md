---
title: A Claude turn ends with no tool call left running or waiting
domain: claude
status: built
priority: high
created: 2026-09-28
revalidated: 2026-09-28
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-claude/src/session.ts#L1791-L1796](../../../../packages/agent-claude/src/session.ts#L1791-L1796) - a permission ask whose call and agent are both unknown falls back to `mainScope`"
  - "[code://packages/agent-claude/src/session.ts#L2578](../../../../packages/agent-claude/src/session.ts#L2578) - a completed or failed turn is pushed with its parts as they are"
  - "[code://packages/agent-claude/src/session.ts#L3268-L3274](../../../../packages/agent-claude/src/session.ts#L3268-L3274) - a cancelled turn is pushed the same way"
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) - pi's `finish`, the pattern: a row still streaming is marked `cancelled` with reason `skipped`"
  - npm://@microsoft/agent-host-protocol@0.9.0 - the reducer's `endTurn`, which cancels open tool calls for a live client
---

## Goal

A Claude turn that ends, however it ends, leaves no tool call running or waiting for confirmation, so a client that subscribes later sees the same thing as one that watched it live.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- Reported on 2026-09-28 from another session: a subagent's tool call that lands in the lead chat (a permission ask falling back to `mainScope`, for example a background agent resumed through `SendMessage`) is never completed there.
- A live client's reducer cancels open calls on `chat/turnComplete` or `chat/turnCancelled`; the backend's own snapshot keeps them `running` or `pending-confirmation`, which is what a re-subscribe gets.

### Runtime path

```
canUseTool (unknown call, unknown agent) -> mainScope -> tool part on the lead turn -> result never arrives there
result / cancel -> turns.push(turn) with the part still open -> snapshot -> re-subscribing client
```

### Gaps

- The two turn-ending paths do not settle open tool parts.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| When a turn ends, every tool part still streaming, running or pending confirmation becomes `cancelled` with reason `skipped`, and a pending ask on it is declined. | Softov, 2026-09-28: "Settle open tool parts to cancelled/skipped when a turn ends." | 01 |
| The snapshot matches what the protocol reducer shows a live client. | the reducer's `endTurn` | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A turn's open tool calls are settled when it ends](task-01-open-calls-are-settled-when-a-turn-ends.md) | done | - |

## Risks and tradeoffs

- Routing such a call to its worker chat instead of the lead is not done here; this plan only makes the end state true.

## Resume state

- **Done so far:** every task done 2026-09-28 (`373253e`), approved by Softov; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** a worker's own turn ends through `endWorker`, which needs the same settling on the worker's scope.

## Final verification checklist

- [ ] A re-subscribe after a turn that ended with an open call shows it cancelled.
- [ ] `pnpm typecheck`, `pnpm boundary`, `pnpm test` green; `plans/index.md` updated.
