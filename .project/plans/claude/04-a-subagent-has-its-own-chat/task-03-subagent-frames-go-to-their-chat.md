---
title: Claude's subagent frames go to that chat
status: todo
depends: [task-01-a-subagent-on-a-real-stream.md, task-02-the-host-opens-a-subagent-chat.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L2187](../../../../packages/agent-claude/src/session.ts#L2187) - stream events"
  - "[code://packages/agent-claude/src/session.ts#L818](../../../../packages/agent-claude/src/session.ts#L818) - `rounds`"
  - "[code://packages/agent-claude/src/session.ts#L1670](../../../../packages/agent-claude/src/session.ts#L1670) - the SDK options"
---

## Objective

Every frame Claude sends from inside a subagent is drawn on that subagent's chat, and the main turn keeps only the `Task` call.

## Files

- `UPDATE: packages/agent-claude/src/session.ts` - `forwardSubagentText: true`; a registry of spawning calls; per-scope parts and turns; routing by `parent_tool_use_id`.
- `CREATE: test/agent-claude-subagent.test.ts` - replays task 01's fixture.

## Steps

1. Set `forwardSubagentText: true` beside `includePartialMessages`.
2. Record each `Task` or `Agent` `tool_use`: its id, `subagent_type`, `description`, `prompt`, and the subagent it was itself called from.
3. On the first `stream_event`, `assistant` or `user` frame whose `parent_tool_use_id` is a recorded call, open its chat through `start.subagent`; with no record, open it as `Subagent`.
4. Keep the parts, tool calls and reasoning of each scope apart, so a subagent's `#<message>:<index>` keys and turn never mix with the main turn's, and emit them on the subagent's chat.
5. Announce an empty round inside a subagent on its chat, using the per-scope `rounds` that exist already.
6. Without `start.subagent`, keep today's behaviour.

## Validation

- The fixture replay draws the subagent's text and tool call on its chat and none of them in the main turn.
- The main turn keeps the `Task` call, with the `subagent` content on it.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.

## Resume

