---
title: A chat lists the shells and subagents running in its background - implemented
date: 2026-10-09
refs:
  - "[code://packages/agent-claude/src/session/workers.ts](../../../../packages/agent-claude/src/session/workers.ts)"
  - "[code://packages/agent-claude/src/session/query.ts](../../../../packages/agent-claude/src/session/query.ts)"
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts)"
---

On Claude, a chat lists the shells and subagents its agent left running, with `chat/backgroundWorkSet` and `chat/backgroundWorkRemoved`.
A client that subscribes later reads the same list from the chat's `backgroundWork`.
A subagent is listed at its `task_started`, and its entry links to the worker chat by the URI built from the spawning call's id.
The worker chat itself still opens when claude/17 says.

## What was built

- [`code://packages/agent-claude/src/session/workers.ts`](../../../../packages/agent-claude/src/session/workers.ts) - `taskInfo`, `live` and `told`, and `reconcileWork`, which emits only the difference for each chat.
- [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts) - reads `task_started`, `background_tasks_changed` and a terminal `task_notification`.
- [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - the lead chat's list in `chatState()`, cleared at close.
- [`code://packages/sdk/src/index.ts`](../../../../packages/sdk/src/index.ts) - exports `subagentChatUri`.
- [`code://docs/AHP.md`](../../../../docs/AHP.md) - the two action rows.

## Verified

- In the review worktree on main `d20a6b3`: install, schema, build, typecheck and boundary pass, and the suite passes 4678 tests in 265 files.
- `agent-claude-background-work.test.ts` has nine cases, the first replaying `claude-subagent-background.jsonl` frame by frame.
- The subagent case checks the listed `chat` against the URI the seam hands that worker.
- `conformance.test.ts` reads a shell entry live and from a later snapshot; `nested-proxy.test.ts` carries both actions through a nested host.

## Departures from the plan

- Until the worker chat opens, the entry's `chat` comes from `subagentChatUri`, by Softov's answer of 2026-10-09.
- Step 6 read it from the open chat.
- `packages/sdk/src/index.ts` exports `subagentChatUri`, a file no task named.
- Task 02's step 3 was not needed: the host already passes the actions through, and `host.ts` is unchanged.

## Left for later

- none.
