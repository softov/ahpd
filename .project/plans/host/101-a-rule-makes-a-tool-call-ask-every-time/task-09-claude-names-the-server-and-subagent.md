---
title: Claude names the server and the subagent
status: todo
depends: [task-02-claude-asks-for-a-matched-tool.md]
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/asking.ts#L60-L72](../../../../packages/agent-claude/src/session/asking.ts#L60-L72) - `referenceName` splits `mcp__<server>__<tool>` at the first `__`"
  - "[code://packages/agent-claude/src/session/asking.ts#L592-L631](../../../../packages/agent-claude/src/session/asking.ts#L592-L631) - `ruleFirst`, which asks with no `agentId`"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.301 - `PreToolUseHookInput.mcp_server` with the server's name, and `agent_id` in a subagent
---

## Objective

The Claude hook matches a rule by the server's real name, and asks a subagent's question on the subagent's chat.

## Files

- `UPDATE: packages/agent-claude/src/session/asking.ts:60-72` - take the server name from the hook input when it is there.
- `UPDATE: packages/agent-claude/src/session/asking.ts:592-631` - pass `agent_id` to `askPerson` as `agentId`.
- `UPDATE: packages/agent-claude/test/agent-claude-autoapproval.test.ts` - a renamed server, a server name with `__`, and a subagent call.

## Steps

1. Give `referenceName` an optional server name.
2. For an `mcp__` name with a server name, use `<server>/<tool>`.
3. Take the tool part after the prefix `mcp__<server>__`.
4. In `ruleFirst`, pass `input.mcp_server?.name` to `referenceName`.
5. In `ruleFirst`, pass `input.agent_id` to `askPerson` as `agentId`.
6. Keep the regular expression for ACP, which has no server field, and say so in a comment.
7. Add the tests named in *Files*.

## Validation

- `packages/agent-claude/test/agent-claude-autoapproval.test.ts`: a rule `my__server/tool` matches the call `mcp__my__server__tool` when `mcp_server.name` is `my__server`.
- `packages/agent-claude/test/agent-claude-autoapproval.test.ts`: a matched call from a subagent asks with that subagent's `agentId`.
- Run `pnpm --filter @ahpd/agent-claude test` alone. Expect a pass.

## Resume

