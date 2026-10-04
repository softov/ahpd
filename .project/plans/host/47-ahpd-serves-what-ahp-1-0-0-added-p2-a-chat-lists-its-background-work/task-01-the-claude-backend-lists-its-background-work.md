---
title: The Claude backend lists its background shells and subagents
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L971-L995](../../../../packages/agent-claude/src/session.ts#L971-L995) - `Spawning` (its `chat` is the worker chat's URI) and the existing `background` set"
  - "[code://packages/agent-claude/src/session.ts#L1059-L1070](../../../../packages/agent-claude/src/session.ts#L1059-L1070) - `scopeOfCall` and `emitOn`"
  - "[code://packages/agent-claude/src/session.ts#L2800-L2826](../../../../packages/agent-claude/src/session.ts#L2800-L2826) - where `task_started` and `task_notification` are read"
  - "[code://packages/agent-claude/src/session.ts#L3134-L3155](../../../../packages/agent-claude/src/session.ts#L3134-L3155) - `chatState`"
  - "[code://packages/agent-claude/src/session.ts#L3790-L3795](../../../../packages/agent-claude/src/session.ts#L3790-L3795) - `close`"
  - "[code://packages/agent-claude/test/agent-claude-subagent.test.ts#L20-L90](../../../../packages/agent-claude/test/agent-claude-subagent.test.ts#L20-L90) - the fake SDK feed and the capture loader"
  - "[code://packages/agent-claude/test/fixtures/claude-subagent-background.jsonl](../../../../packages/agent-claude/test/fixtures/claude-subagent-background.jsonl) - the capture the first case replays"
---

## Objective

While a Claude session runs, each chat's `backgroundWork` is the live, non-ambient background tasks its agent started: a `local_bash` task as a `shell` entry with the command of the `Bash` call that started it, a `local_agent` task as a `subagent` entry linking the worker chat; `chat/backgroundWorkSet` says each one as it appears or changes, and `chat/backgroundWorkRemoved` as it goes.

## Files

- `UPDATE: packages/agent-claude/src/session.ts` - beside `background`: `taskInfo` (task id to `{ type, toolUseId, description, startedAt }`), `live` (the last level's non-ambient ids), and `told` (chat URI to entries by id); a `reconcileWork()` that builds the entries and emits the difference; reading `background_tasks_changed`; `chatState` lists the lead chat's entries; `close` clears all three without emitting.
- `CREATE: packages/agent-claude/test/agent-claude-background-work.test.ts` - the cases below, on the fake SDK feed copied from `agent-claude-subagent.test.ts`.
- `UPDATE: docs/AHP.md` - `chat/backgroundWorkSet` and `chat/backgroundWorkRemoved` rows: host, Claude only, what each kind carries.

## Steps

1. On `task_started` record `taskInfo`, `startedAt` being `new Date().toISOString()` when the frame is read; keep the existing worker bookkeeping as it is; then `reconcileWork()`.
2. On `background_tasks_changed` set `live` to the ids of the tasks whose `ambient` is not `true`; then `reconcileWork()`.
3. On a terminal `task_notification` drop its id from `live` and `taskInfo`; then `reconcileWork()`.
4. `reconcileWork()`: for each id in `live` with a `taskInfo` whose `type` is `local_bash` or `local_agent`, find the chat with `scopeOfCall(toolUseId)`.
5. A `local_bash` entry is `{ kind: 'shell', id: 'shell:<id>', label: description, startedAt, command }`, `command` being the call's `toolInput.command` when it is a string and `description` otherwise.
6. A `local_agent` entry is `{ kind: 'subagent', id: 'subagent:<id>', label: description, startedAt, chat }`, `chat` being `spawning.get(toolUseId)?.chat`; with no `chat` it is skipped.
7. Compare with `told` per chat by `JSON.stringify` and emit only what differs, removals first.
8. Any other `task_type`, and a task whose call no scope holds, is not listed.

## Validation

- `packages/agent-claude/test/agent-claude-background-work.test.ts`, replaying `claude-subagent-background.jsonl` with a host seam that opens worker chats: after frame 3 the lead chat got one `chat/backgroundWorkSet` with `{ kind: 'subagent', id: 'subagent:af279e8136cb23ae9', label: 'List files recursively', chat: <the worker chat's URI> }` and `chatState().backgroundWork` holds it; frames 4-11 emit no further background action; frame 12 emits one `chat/backgroundWorkRemoved` with that id and `chatState()` has no `backgroundWork` key.
- The same file, synthetic frames: a `Bash` call with `command: 'sleep 100'` and `run_in_background: true`, its `task_started` with `task_type: 'local_bash'`, then a level naming it, lists `{ kind: 'shell', id: 'shell:<id>', command: 'sleep 100' }`; the same task with `ambient: true` in the level lists nothing; a level naming an id with no `task_started` lists nothing until the `task_started` comes, then lists it; a `local_bash` task never named by a level (a foreground shell) lists nothing; a terminal `task_notification` removes the entry even when no level follows; a `Bash` call inside a worker lists its shell on the worker's chat through `SubagentChat.emit`, not on the lead chat; with no subagent seam a backgrounded `local_agent` lists nothing; `close()` emits nothing.
- `pnpm exec vitest run packages/agent-claude/test` passes, the existing subagent cases unchanged.

## Resume
