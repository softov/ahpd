---
title: The /mcp door refuses a matched tool
status: todo
depends: [task-01-the-rule-is-read-in-the-approval-check.md]
layer: server
refs:
  - "[code://packages/server/src/mcp.ts#L81-L90](../../../../packages/server/src/mcp.ts#L81-L90) - the person's `/mcp` door calls `answerTools` with no `mayRun`"
  - "[code://packages/sdk/src/tools/server.ts#L255](../../../../packages/sdk/src/tools/server.ts#L255) - `mayRun`, checked before `tools/call`"
  - "[code://packages/sdk/src/host/spawn.ts#L143-L151](../../../../packages/sdk/src/host/spawn.ts#L143-L151) - `asksForTool`, the matcher"
---

## Objective

A call through `/mcp` to a host tool the rule names is refused, because the door has no session to ask in.

## Files

- `UPDATE: packages/sdk/src/host/spawn.ts:143-151` - export `asksForTool`, or move it to a module both callers import.
- `UPDATE: packages/server/src/mcp.ts:81-90` - pass a `mayRun` that refuses a matched tool, on the person path and the root path.
- `UPDATE: packages/server/test` - a matched tool and an unmatched tool through `/mcp`.

## Steps

1. Make `asksForTool` importable from the server.
2. Give both `answerTools` calls in `mcp.ts` a `mayRun` that reads the host's root config.
3. Refuse a tool whose name `ahp/<name>` the rule matches, with a message that names the rule.
4. Allow every other tool, as now.
5. Add the tests named in *Files*.

## Validation

- `packages/server/test`: with `{"ahp/<tool>": false}`, the host refuses a `/mcp` call to that tool.
- `packages/server/test`: the refusal names `eligibleForAutoApproval`.
- `packages/server/test`: an unmatched tool runs.
- Run `pnpm --filter @ahpd/server test` alone. Expect a pass.

## Resume

- **Done so far:** nothing. Stopped on 2026-11-03 before the first edit: the server has no way to read the host's pushed root config, and this task's Files name no sdk change that would add one. The question is in the plan's Resume state.
