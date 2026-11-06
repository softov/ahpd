---
title: ACP asks for a matched tool
status: done
depends: [task-01-the-rule-is-read-in-the-approval-check.md]
layer: agent-acp
refs:
  - "[code://packages/agent-acp/src/session/handlers.ts#L285-L340](../../../../packages/agent-acp/src/session/handlers.ts#L285-L340) - `askPermission` and `confirmationOptions`"
---

## Objective

For a matched tool, `askPermission` asks and offers only the agent's `allow_once` and `reject_once` options.
The host enforces the rule only on the MCP tools it serves.

## Files

- `UPDATE: packages/agent-acp/src/session/handlers.ts:285-340` - remove `allow_always` and `reject_always` for a matched tool.
- `UPDATE: packages/agent-acp/test` - a matched tool, and an unmatched one.

## Steps

1. Call the session's check in `askPermission` with the tool name.
2. Remove the `allow_always` and `reject_always` options for a matched tool.
3. Find where the host serves its MCP tools to an ACP agent.
4. Make each matched MCP tool ask the person before it runs, even when the agent did not ask.
5. Write the tests.
6. Set this task and the plan row to `implemented`.

## Validation

- The agent-acp tests pass.
- A matched tool shows no "always" option.
- `pnpm -s build` and `pnpm -s typecheck` pass.

## Resume

- **Done so far:** 2026-10-19. `askPermission` reads the rule for the call's name. For a matched tool it offers only the agent's `allow_once` and `reject_once` options, on the question and on the call's own ready. `referenceName` builds the name: `mcp__<server>__<tool>` becomes `<server>/<tool>`, and anything else is the bare name. A matched call also skips the terminal allow of host/100, so the rule wins over it. The rule is read without an await, so an update behind the request cannot ready the call first. The host serves its tools to the ACP agent as one MCP server. A `tools/call` never passes through this bridge, so step 4 is enforced inside that server. `ToolsServers.open` takes an optional `mayRun`, asked before either branch runs anything. A refusal comes back to the model as a failed call reading `<tool> was declined by a person`. `Start.toolsServer` passes the callback through, and `opening.ts` hands it `ctx.askTool`. That asks a question with approve and deny for a matched `ahp/<tool>`, and returns the person's answer. Tests: `packages/agent-acp/test/agent-acp-rule.test.ts` (5). They use a real HTTP listener in front of `ToolsServers.request`, so the fixture's `mreq` reaches the endpoint as the daemon's agents do. The whole agent-acp suite passes (18 files, 271 tests).
- **Next action:** build [task-04-pi-asks-for-a-matched-tool.md](task-04-pi-asks-for-a-matched-tool.md).
- **Open questions:** none.
- **Watch out for:** this task's Files list names only `handlers.ts` and the tests. Step 4 also needed `packages/sdk/src/tools/server.ts`, `types/agent.ts`, `host/spawn.ts` and `index.ts`, beside `opening.ts`, for the `mayRun` callback. The synthesized question draws its own row, with the id `mcp-question-<n>` and the title of the tool. An agent that runs its own tools without asking is still out of reach, and task 06 says so.
