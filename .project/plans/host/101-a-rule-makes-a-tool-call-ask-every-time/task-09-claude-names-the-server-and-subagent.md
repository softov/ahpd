---
title: Claude names the server and the subagent
status: done
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

- **Done so far:** 2026-11-03. `referenceName` in `packages/agent-claude/src/session/asking.ts` takes an optional server name. With one, it uses the prefix `mcp__<server>__` when the tool name carries it. Otherwise it keeps the server's name and reads the tool after the first `__`. Without one, it keeps the split, with a comment that `canUseTool` is told no server. `ruleFirst` passes `input.mcp_server?.name` and hands `input.agent_id` to `askPerson` as `agentId`. Tests: `packages/agent-claude/test/agent-claude-autoapproval.test.ts` (23). Three are new. A server keyed `my server` with the prefix `my_server` matches the rule `my server/move`. A server keyed `my__server` matches `my__server/move` rather than the `my/server__move` a split reads. A subagent's second matched call, whose frame has not arrived, is asked on the subagent's chat because the hook passes its `agent_id`. The whole agent-claude suite passes (56 files, 528 tests).
- **Next action:** build [task-10-the-docs-say-where-the-rule-holds.md](task-10-the-docs-say-where-the-rule-holds.md) once [task-08-the-mcp-door-refuses-a-matched-tool.md](task-08-the-mcp-door-refuses-a-matched-tool.md) is answered.
- **Open questions:** none.
- **Watch out for:** `canUseTool` is still told no server. In a mode where the rule hook did not run first, it reads a renamed server by the split. The hook runs for every `PreToolUse` call, so a matched call is answered from `ruledBy` before that read matters.

