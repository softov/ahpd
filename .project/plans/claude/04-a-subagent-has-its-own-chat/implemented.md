---
title: A subagent has its own chat, linked from the call that started it - implemented
date: 2026-09-28
refs:
  - git://c8249a1
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts) - a `Scope` per conversation, the routing by `parent_tool_use_id`, the endings and the asks"
  - "[code://packages/agent-claude/src/transcript.ts](../../../../packages/agent-claude/src/transcript.ts) - `subagentsOf`, the restore from the CLI's meta files"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `Start.subagent`, the worker chats, `WORKER_ACTIONS`"
  - "[code://packages/sdk/src/calllinks.ts](../../../../packages/sdk/src/calllinks.ts) - the content of spawning calls, held while a worker needs it"
---

A subagent Claude starts is its own read-only chat, opened from the `Task` or `Agent` call that started it, with its text, thinking and tool calls, and it is there again after a restart.
A permission or a question asked inside a subagent is asked on its chat, and an answer or a stop given there reaches the session.

## What was built

- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - `SubagentRequest` and `SubagentChat`, the seam a backend opens a worker chat through.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `Start.subagent` mints `ahp-chat://subagent/<base64url session>/<call id>`, announces the chat `read-only` with a `tool` origin, opens its turn, links the spawning call with `subagent` content and `_meta.subagentChatUri`, and reduces the worker's actions through the protocol's `chatReducer`; a worker chat takes `chat/toolCallConfirmed`, `chat/inputCompleted` and `chat/turnCancelled`, resolved to its session's lead chat, and refuses every other action.
- [`code://packages/sdk/src/calllinks.ts`](../../../../packages/sdk/src/calllinks.ts) - each chat's open turn and the content of spawning calls only, forgotten with the worker chat or the session.
- [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - `forwardSubagentText: true`; a `Scope` per spawning call; frames routed by `parent_tool_use_id`; `subagentDescription` and `subagentAgentName` on the call's `_meta`; a foreground worker ends on its result or notification, a background one on its notification, once; a cancel ends the workers of that turn; an ask is drawn on the worker's chat through `toolUseID` and `agentID`.
- [`code://packages/agent-claude/src/transcript.ts`](../../../../packages/agent-claude/src/transcript.ts) - `subagentsOf` reads `subagents/agent-<id>.meta.json`, falls back to the `agentId:` line in the spawning result, and links a nested worker from its parent worker.
- [`code://packages/agent-claude/README.md`](../../../../packages/agent-claude/README.md), [`code://docs/PLUGINS.md`](../../../../docs/PLUGINS.md) and [`code://UPSTREAM.md`](../../../../UPSTREAM.md) - the worker chat, the seam, and the upstream line.

## Verified

- [`code://packages/agent-claude/test/agent-claude-subagent.test.ts`](../../../../packages/agent-claude/test/agent-claude-subagent.test.ts) - replays three captured streams (`claude-subagent.jsonl`, `claude-subagent-background.jsonl`, `claude-subagent-ask.jsonl`): routing, the link on the completion, the endings foreground and background, cancel, and an ask inside a worker at the point the SDK called `canUseTool`.
- [`code://packages/agent-claude/test/agent-claude-subagent-restore.test.ts`](../../../../packages/agent-claude/test/agent-claude-subagent-restore.test.ts) - meta-linked, suffix-linked, unlinked and nested workers read back, and a resumed session keeping its restored workers.
- [`code://packages/sdk/test/subagent-chat.test.ts`](../../../../packages/sdk/test/subagent-chat.test.ts) and [`code://packages/sdk/test/calllinks.test.ts`](../../../../packages/sdk/test/calllinks.test.ts) - the seam against the strict protocol schema, the nested link, the worker channel's own actions on the wire, answers and a stop on a worker chat under the held and an aliased spelling, and a call's content held only for spawning calls.
- Softov checked on 2026-09-28: approve and stop inside a subagent in ahpapp, and in VS Code the subagent as its own chat opened from the call, an ask inside it on its chat, and the chat still there after a daemon restart.
- `pnpm typecheck` and `pnpm boundary` clean, `pnpm test` green at the close.

## Departures from the plan

- A subagent's frames are routed from the canonical `assistant` and `user` frames: no `stream_event` carried a `parent_tool_use_id` in any capture.
- `Start.subagent` also returns `turnId`, because every part the backend emits has to name the turn the host opened.
- Background is told by the reference's rule (task 14) rather than `is_backgrounded`, which task 01 first used: any `task_started` marks its call background, and a call whose input does not say `run_in_background: true` also ends on its result.
- A worker chat is not wholly read-only: it takes answers and a stop, which the plan's read-only chat did not (task 17).

## Left for later

- Nothing from the plan. A worker the CLI backgrounds without being asked ends on its "launched" result, and a live chat's `subagent` links name the session in the spelling the host holds it under.
