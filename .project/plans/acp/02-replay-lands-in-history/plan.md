---
title: Replay lands in the session's history, never in its next turn
domain: acp
status: planned
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-acp/src/session.ts#L277-L282](../../../../packages/agent-acp/src/session.ts#L277-L282) - updates go to `mapping` whenever it is set"
  - "[code://packages/agent-acp/src/session.ts#L851-L869](../../../../packages/agent-acp/src/session.ts#L851-L869) - `begin` sets `mapping` before `open()`, so a load's replay lands in the new turn"
  - "[code://packages/agent-acp/src/transcript.ts#L38-L65](../../../../packages/agent-acp/src/transcript.ts#L38-L65) - the transcript is watched turns replayed through the mapper"
  - "[code://packages/agent-acp/src/catalog.ts#L31-L100](../../../../packages/agent-acp/src/catalog.ts#L31-L100) - the watched catalogue"
  - "[code://.project/plans/plugin/18-the-acp-bridge-resumes-forks-and-asks/plan.md](../../../../.project/plans/plugin/18-the-acp-bridge-resumes-forks-and-asks/plan.md) - the resume that builds on this"
---

## Goal

The updates a server replays on `session/load` are collected apart from any turn and become the session's earlier turns, so a resumed or listed session opens with its history and the first new turn holds only its own answer.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Runtime path

```
begin -> [changes] open() first, mapping set after -> session/load -> replay -> [new] collected
  -> [new] split at each user_message_chunk -> watched turns -> transcript
```

### Gaps

- Replay is written into the first new turn; a load from `setConfig` drops it.
- After a restart, a session opens blank until its next turn: `session/load` runs only when a turn opens the server.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| A replayed turn starts at each `user_message_chunk` | the spec's replay order: the user message, then the agent's updates | 02 |
| Plugin 18 task 01 builds on this plan | both change `open`; this one is the ground | - |
| A session this process never watched is loaded when a client reads its transcript, where the server advertises `loadSession`; its restored tool calls carry no times, since ACP has none | Softov, 2026-09-29, asked "After a daemon restart, an ACP session opens blank until a turn starts, although the server could replay its history with session/load (v1) or session/resume with replayFrom (v2 draft). Should that be planned?": "Plan it in acp" | 03 |

## Proposed architecture

- **Layer responsibilities** - `session.ts`: when `mapping` is live · `transcript.ts` and `catalog.ts`: turns from collected replay.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Replay is collected, not mapped into a turn](task-01-replay-is-collected-not-mapped-into-a-turn.md) | todo | - |
| [02 - Collected replay becomes the session's earlier turns](task-02-collected-replay-becomes-turns.md) | todo | 01 |
| [03 - A session never watched is loaded when a client reads it](task-03-a-session-opened-after-a-restart-is-loaded.md) | todo | 02 |

## Risks and tradeoffs

- A server that replays without a `user_message_chunk` - its replay becomes one turn with no user text, and the docs say so.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-replay-is-collected-not-mapped-into-a-turn.md](task-01-replay-is-collected-not-mapped-into-a-turn.md).
- **Open questions:** none.
- **Watch out for:** plugin 18 task 01 changes the same `open`; do this plan first.

## Final verification checklist

- [ ] A loaded session opens with its history and its first new turn holds only its own answer.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `plans/index.md` updated.
