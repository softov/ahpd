---
title: A live worker chat opens once its spawn is known, titled by its task
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1112-L1145](../../../../packages/agent-claude/src/session.ts#L1112-L1145) - `scopeFor`"
  - "[code://packages/agent-claude/src/session.ts#L1835-L1855](../../../../packages/agent-claude/src/session.ts#L1835-L1855) - the spawn record in `assistant()`"
  - "[code://packages/agent-claude/src/session.ts#L2108-L2122](../../../../packages/agent-claude/src/session.ts#L2108-L2122) - `workerBlock`"
---

## Objective

A worker's frames that arrive before its spawn is recorded are held, and its chat opens with the description as title and the prompt as the first message once the spawn is known.

## Files

- `UPDATE: packages/agent-claude/src/session.ts` - one `titleOf(info)` used by `scopeFor` and `workerBlock`; `scopeFor` holds frames for a parent with no spawn record; the spawn record is made by one function called from `assistant()` and from the `canUseTool` callback for `Task`/`Agent`; recording a spawn opens the held chat and replays its frames.
- `UPDATE: packages/agent-claude/test/` - the cases below, beside the existing worker-chat tests.

## Steps

1. `titleOf`: `description` trimmed and cut to 60 characters with an ellipsis, else `subagentType`, else `Subagent`.
2. Move the `spawning.set` block into `recordSpawn(id, input, scope)`; call it from `assistant()` as now and from `canUseTool` when the tool is `Task` or `Agent`, without overwriting a record that has a `chat`.
3. In `scopeFor`, a parent with no record and no open scope gets a holding scope whose frames are kept in order.
4. `recordSpawn` for a held parent opens the chat through `options.subagent` with the record, then replays the held frames into it.
5. The spawning call's `tool_result`, or 5 s with no record, opens a held chat with the fallback title and replays.

## Validation

- A worker frame before the `Agent` tool_use: the chat opens after the tool_use, titled by the description, first turn text the prompt, and the early frame is its first part.
- A tool_use before the worker frame: as today, with the description title.
- A spawn recorded by `canUseTool` only: the same title and prompt.
- No spawn ever recorded: the chat opens on the tool result with `Subagent`.
- A description of 80 characters is cut to 60.

## Resume

