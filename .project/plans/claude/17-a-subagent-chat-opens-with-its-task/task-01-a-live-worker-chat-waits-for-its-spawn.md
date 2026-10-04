---
title: A live worker chat opens once its spawn is known, titled by its task
status: implemented
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

Implemented as the steps say, with the hold at `streamed`/`assistant`/`results` rather than in `emitOn`: a frame for a worker whose spawn is not recorded is pushed onto the scope's `waiting` and applied, whole, when `releaseHeld` opens the chat. The frames a worker opens with are its first turn, and the host mints that turn with the prompt the call was given, so a turn built before the chat exists is the wrong turn with the wrong id.

- `titleOf` in `input.ts`, beside the `truncate` it uses: `description` trimmed and cut to 60 with an ellipsis, else `subagent_type` trimmed, else `Subagent`. VS Code's `subagentChatTitle`, one function for `scopeFor`, `workerBlock` and `transcript.ts`.
- `openWorker(parent, info, open)` holds what the old `scopeFor` tail did, and `scopeFor` is now three cases: known, ended, and - new - a worker with no record, which gets a scope whose `waiting` is empty and whose `release` is a `SPAWN_GRACE` (5 s, `unref`'d) timer.
- `releaseHeld(parent, info?)` opens the chat, moves the chat and the turn onto the scope the `byAgent` map and the late frames hold by reference, and replays. It is called from `recordSpawn`, from the `tool_result` of the spawning call - before the part is looked up, since a call the harness described and never announced has no part - and from the timer.
- `recordSpawn(id, input, scope, turnId)` is the block that was in `assistant()`, called from `assistant()` and from `canUseTool` for `Task`/`Agent` when `asked.toolUseID` is there. It returns early on a record that already has a `chat`.
- `emitOn` says nothing at all on a scope with `waiting`, so nothing a held worker triggers by accident reaches the lead chat.
- `close()` clears every pending release and drops the waiting frames.
- `cancel` releases every waiting scope before it ends the turn's workers, so a chat opens as the turn is stopped rather than `SPAWN_GRACE` after it. `releaseHeld` clears the timer on the way, and the loop below then ends it like any other worker with no turn on record. Decided by Softov on 2026-10-04, after the build; the plan had not decided it.

Tests written, in `packages/agent-claude/test/agent-claude-subagent.test.ts`:

- `waits for the spawning call when the worker speaks first` - the fixture with one worker frame delivered before the `Agent` `tool_use`: no chat is asked for while only the frame has been seen, one chat afterwards titled `List files in folder` and opened on the prompt, and the raced frame is `actions[0]` rather than a later part.
- `records the spawn from the permission callback, which the SDK runs first` - `canUseTool` handed the whole input and confirmed, the canonical message never arriving: no chat yet, and the worker's first frame opens one titled by that record with that prompt.
- `opens a held worker on its own result when no spawn was ever recorded` - only a worker's frame and then the spawning call's `tool_result`: the chat opens as `Subagent`, with the prompt absent and the held frame on it.
- `names a worker chat by its task, cut to sixty characters` - `titleOf` directly, including the whitespace-only description and the trimmed-then-cut one.
- `cancels a worker that was still waiting for its spawn` - a worker frame with no call behind it, then `session.cancel('')`: no chat until the cancel, one chat afterwards titled `Subagent` with the held frame on it, ended once as `cancelled`. It then waits out `SPAWN_GRACE` in real time to show the timer went with the chat. Verified failing without the `cancel` change.

Two existing tests changed with the title rule, not with the hold: the live fixture's chat and its `subagent` block are `List files in folder` and `List files recursively` rather than `Explore`.

One existing test needed a frame it had been leaving out. `agent-claude-usage.test.ts`'s `asSubagent` stamped a worker's stream events with a `parent_tool_use_id` and no spawning call, which is a worker no harness sends; its frames are now held for `SPAWN_GRACE` and its tokens are not counted inside the test's settle, so the helper emits the `Agent` `tool_use` in front of them. Its `model` is left off, as the rest of that fixture's assistant frames are, because `assistant()` reads it as the session's own model.

Not verified: "a build session that spawns background `Agent` workers" by hand. There is no client in this repository to watch the titles in. What the fixtures say is asserted above.

