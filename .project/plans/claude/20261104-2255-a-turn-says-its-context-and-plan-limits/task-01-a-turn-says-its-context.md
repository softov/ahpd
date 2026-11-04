---
title: A turn says its context
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/parts.ts#L187-L200](../../../../packages/agent-claude/src/session/parts.ts#L187-L200) - where a result's `modelUsage` is read"
  - "[code://packages/agent-claude/src/claude.ts#L513-L524](../../../../packages/agent-claude/src/claude.ts#L513-L524) - `probe` and `probeChanged`"
---

## Objective

A Claude model row has the `maxContextWindow` its results name, and each Claude turn's usage says what fills the context window.
The breakdown is `contextAttribution` in VS Code's shape, and the rest is `ahpd.context`.

## Files

- `UPDATE: packages/agent-claude/src/session/parts.ts:187-200` - keep each model's `contextWindow` and `maxOutputTokens` from the result's `modelUsage`.
- `UPDATE: packages/agent-claude/src/claude.ts:513-524` - the probe fills `maxContextWindow` and `maxOutputTokens` from the learned limits, and a newly learned limit fires `probeChanged`.
- `UPDATE: packages/agent-claude/src/session/query.ts` - on a result, ask `getContextUsage({ detail: 'summary' })` with a short time limit, and put the answer on the turn's usage.
- `CREATE: packages/agent-claude/src/session/context.ts` - map an `SDKContextUsage` to `contextAttribution` and `ahpd.context`.
- `CREATE: packages/agent-claude/test/agent-claude-context.test.ts` - the map, the learned limit, and a turn that ends when the breakdown is late.

## Steps

1. Keep each model's `contextWindow` and `maxOutputTokens` from a result's `modelUsage`, in memory, by model.
2. Match a learned limit to a model row by its `resolvedModel` or the entry's `canonicalModel`.
3. Fill `maxContextWindow` and `maxOutputTokens` on the probed rows from the learned limits.
4. Fire `probeChanged` when a result teaches a limit the rows do not have yet.
5. On a result, ask `getContextUsage({ detail: 'summary' })`, and stop waiting after two seconds.
6. Map the system prompt and the memory files to `system` entries, and the system tools to `toolDefinition`.
7. Map the skills to `skill`, the custom agents to `subagent`, and the MCP tools to `mcpServer`.
8. Leave the messages out of the entries, because a reader counts what the entries leave as messages.
9. Set `totalTokens` to the answer's `total_tokens`, and `compactions.count` to 0 when the answer has no count.
10. Write `ahpd.context` with `used`, `size` as `raw_max_tokens`, `limit` as the model's limit, and the `free`, `buffer` and `deferred` tokens.
11. Keep the `used` and `size` names that agent-acp already writes, so one reader reads both.
12. Put both keys on the turn's usage `_meta`, beside `ahpd.cost`.
13. End the turn without them when the answer is late or fails, and log one line.
14. Write the tests of *Files*.

## Validation

- `packages/agent-claude/test/agent-claude-context.test.ts` passes.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass, and the agent-claude tests pass.

## Resume

Done: each result's `modelUsage` teaches a model's `contextWindow` and `maxOutputTokens`, the probe fills the rows and fires `probeChanged` on a new limit, and a turn asks `getContextUsage({ detail: 'summary' })` with a two-second limit and carries `contextAttribution` and `ahpd.context`.
Left: nothing.
Found: `session/context.ts` already names the session context, so the map is `session/contextusage.ts`.
Found: the control answer spells its fields in camelCase, so the map reads both spellings.
Found: `resolvedModel` did not reach `Offered.models`, so the sdk type and `probe.ts` now carry it.

