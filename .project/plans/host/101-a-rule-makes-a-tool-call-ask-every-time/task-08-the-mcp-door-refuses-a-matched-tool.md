---
title: The /mcp door refuses a matched tool
status: implemented
depends: [task-01-the-rule-is-read-in-the-approval-check.md]
layer: server
refs:
  - "[code://packages/server/src/mcp.ts#L81-L90](../../../../packages/server/src/mcp.ts#L81-L90) - the `/mcp` door serves the host's sessionless tools, on the person path and the root path"
  - "[code://packages/sdk/src/host/tooling.ts#L2078-L2120](../../../../packages/sdk/src/host/tooling.ts#L2078-L2120) - `sessionlessTools`, which binds each tool's `run` and reads `rootConfig`"
  - "[code://packages/sdk/src/host/spawn.ts#L143-L151](../../../../packages/sdk/src/host/spawn.ts#L143-L151) - `asksForTool`, the matcher"
---

## Objective

A call through `/mcp` to a host tool the rule names is refused, because the door has no session to ask in.

## Files

- `UPDATE: packages/sdk/src/host/spawn.ts:143-151` - export `asksForTool`, or move it to a module both callers import.
- `UPDATE: packages/sdk/src/host/tooling.ts:2078-2120` - a bound tool's `run` refuses a tool that the rule matches.
- `UPDATE: packages/sdk/test/sessiontools.test.ts` - a matched tool is refused and an unmatched tool runs.
- `UPDATE: packages/server/test/mcp.test.ts` - a matched tool and an unmatched tool through `/mcp`.

## Steps

1. Make `asksForTool` importable from `tooling.ts`.
2. In `sessionlessTools`, read `rootConfig` in each bound tool's `run`, at call time.
3. Throw an error that names `eligibleForAutoApproval` when the rule matches `ahp/<name>`.
4. Let the existing `catch` raise the failed `tool_call` event for the refusal.
5. Run every other tool, as now.
6. Add the tests named in *Files*.

## Validation

- `packages/sdk/test/sessiontools.test.ts`: with `{"ahp/<tool>": false}`, the bound tool's `run` throws, and the tool's own `run` is not called.
- `packages/server/test/mcp.test.ts`: the same root config makes a `/mcp` call to that tool fail with a message that names `eligibleForAutoApproval`.
- `packages/server/test/mcp.test.ts`: an unmatched tool runs.
- Run `pnpm --filter @ahpd/sdk test` and then `pnpm --filter @ahpd/server test`. Expect a pass.

## Resume

- **Done so far:** 2026-11-03. Softov answered the open question on 2026-11-03: the refusal is made in `sessionlessTools`. `asksForTool` in `packages/sdk/src/host/spawn.ts` is exported. In `packages/sdk/src/host/tooling.ts`, each sessionless tool's `run` reads the live `rootConfig` at call time and throws when the rule names `ahp/<name>`. The throw is inside the existing `try`, so the failed `tool_call` event is raised and the error reaches the model with the key's name. Tests: `packages/sdk/test/sessiontools.test.ts` (one new case, with an owner token that may push `config:change`). `packages/server/test/mcp.test.ts` has one new case through `/mcp`, with `create_session` refused and `list_sessions` run. The whole sdk suite passes (213 files, 4053 tests) and so does the server suite (88 files, 1757 tests).
- **Next action:** build [task-10-the-docs-say-where-the-rule-holds.md](task-10-the-docs-say-where-the-rule-holds.md).
- **Open questions:** none.
- **Watch out for:** the check reads `definition.name`, which is the name after `forSession` has shaped it. The rule key is that name with the `ahp/` prefix. A tool a session names differently through `forSession` is refused under the name this door offers.
