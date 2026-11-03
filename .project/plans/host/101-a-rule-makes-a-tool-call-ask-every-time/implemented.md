---
title: A rule makes a tool call ask every time - implemented
date: 2026-11-03
refs:
  - git://fea97bcb - the last commit before this record
  - "[code://packages/sdk/src/vscoderootconfig.ts#L342-L359](../../../../packages/sdk/src/vscoderootconfig.ts#L342-L359)"
  - "[code://packages/sdk/src/host/spawn.ts#L128-L151](../../../../packages/sdk/src/host/spawn.ts#L128-L151)"
  - "[code://packages/sdk/src/host/tooling.ts#L2104-L2111](../../../../packages/sdk/src/host/tooling.ts#L2104-L2111)"
  - "[code://packages/agent-claude/src/session/asking.ts#L588-L643](../../../../packages/agent-claude/src/session/asking.ts#L588-L643)"
  - "[code://packages/agent-acp/src/session/handlers.ts#L502-L539](../../../../packages/agent-acp/src/session/handlers.ts#L502-L539)"
  - "[code://packages/agent-pi/src/session.ts#L486-L537](../../../../packages/agent-pi/src/session.ts#L486-L537)"
  - "[code://packages/agent-cofold/src/turnagent.ts#L385-L407](../../../../packages/agent-cofold/src/turnagent.ts#L385-L407)"
  - "[code://docs/sdk/AHP.md#L196-L209](../../../../docs/sdk/AHP.md#L196-L209)"
---

The operator sets `eligibleForAutoApproval` in the root config, and a tool it names asks every time. It asks in every backend and every permission mode, `bypassPermissions` included. The question offers no "always" option, so an answer applies to that call alone. A `dontAsk` session refuses the call instead of asking, and `/mcp` refuses a matched host tool because that door has no session to ask in. A key names one tool exactly or every tool of a server through `<server>/*`. Each backend's tool keeps its own name and its case, and a host tool is `ahp/<name>` in every backend.

## What was built

- [`code://packages/sdk/src/vscoderootconfig.ts#L353-L359`](../../../../packages/sdk/src/vscoderootconfig.ts#L353-L359) - `eligibleForAutoApproval` is declared as VS Code declares it, a map of tool name to boolean where `false` means the tool asks every time.
- [`code://packages/sdk/src/host/spawn.ts#L143-L151`](../../../../packages/sdk/src/host/spawn.ts#L143-L151) - `asksForTool` matches an exact key first, then `<server>/*`, and reads a non-boolean value as no rule.
- [`code://packages/sdk/src/host/spawn.ts#L948-L951`](../../../../packages/sdk/src/host/spawn.ts#L948-L951) - `Start.getAutoApproval` reads the rule before the terminal rules and answers `'ask'`.
- [`code://packages/agent-claude/src/session/asking.ts#L603-L643`](../../../../packages/agent-claude/src/session/asking.ts#L603-L643) - the `PreToolUse` hook asks for a matched call in every mode, answers `allow` or `deny`, and denies in `dontAsk`. The question carries no suggestions, and a matched call skips `settled`.
- [`code://packages/agent-claude/src/session/asking.ts#L73-L82`](../../../../packages/agent-claude/src/session/asking.ts#L73-L82) - `referenceName` takes the server's real name from `mcp_server.name`, and `ruleFirst` asks a subagent's call on its chat by `agent_id`.
- [`code://packages/agent-acp/src/session/handlers.ts#L502-L539`](../../../../packages/agent-acp/src/session/handlers.ts#L502-L539) - `askPermission` offers only the once options for a matched call, and the host's MCP server asks before it runs a matched host tool.
- [`code://packages/agent-pi/src/session.ts#L486-L494`](../../../../packages/agent-pi/src/session.ts#L486-L494) - `decide` reads the rule first, asks in every mode but `dontAsk`, and refuses there.
- [`code://packages/agent-cofold/src/turnagent.ts#L385-L407`](../../../../packages/agent-cofold/src/turnagent.ts#L385-L407) - `beforeTool` answers `approval` for a matched call in every mode but `dontAsk`, which denies it. It deletes cofold's remembered approval for the tool first.
- [`code://packages/sdk/src/host/tooling.ts#L2104-L2111`](../../../../packages/sdk/src/host/tooling.ts#L2104-L2111) - a sessionless tool's `run` throws for a matched call, so `/mcp` refuses it and runs the tool's own `run` never.
- [`code://docs/sdk/AHP.md#L196-L209`](../../../../docs/sdk/AHP.md#L196-L209) - the rule's paragraph says where it holds and where it does not.

## Verified

- `packages/sdk/test/autoapproval.test.ts` (8), `packages/sdk/test/root-config.test.ts` (31) and the new case in `packages/sdk/test/sessiontools.test.ts`. The whole sdk suite passes: 213 files, 4053 tests, 2 skipped.
- `packages/server/test/mcp.test.ts` has a new case: `/mcp` refuses a matched `create_session` and runs `list_sessions`. The whole server suite passes: 88 files, 1757 tests, 2 skipped.
- `packages/agent-claude/test/agent-claude-autoapproval.test.ts` (23). The whole agent-claude suite passes: 56 files, 528 tests.
- `packages/agent-acp/test/agent-acp-rule.test.ts` (5). The whole agent-acp suite passes: 18 files, 271 tests.
- `packages/agent-pi/test/agent-pi-autoapproval.test.ts` (12). The whole agent-pi suite passes: 15 files, 209 tests.
- `packages/agent-cofold/test/agent-cofold-autoapproval.test.ts` (10). The whole agent-cofold suite passes: 18 files, 277 tests.
- `pnpm -s build`, `pnpm exec tsc -p tsconfig.json --noEmit` and `pnpm boundary` pass on 2026-11-03.
- The docs paragraph was read against the code. `root.ts:302` creates the config empty, so nothing survives a restart. `gate.ts:297-306` requires `config:change`. `tooling.ts:2109-2110` throws for `/mcp`. `turnagent.ts:389-406` asks and deletes the remembered approval. `nested.ts:1204` pushes only `workspaceTrust` inside a machine.
- The prose linter on the plan folder reports nothing.

## Departures from the plan

- Task 03's Files name `handlers.ts` and the tests. Step 4 also needed `packages/sdk/src/tools/server.ts`, `types/agent.ts`, `host/spawn.ts`, `index.ts` and `opening.ts`, for the `mayRun` callback that lets the host's MCP server ask.
- Task 02 leaves `AskUserQuestion` to its own question. The rule's confirmation would settle the chat's question and run the tool with nothing the person said.
- Task 09 uses `mcp_server.name` and `agent_id` from the SDK's hook input. The plan did not name either field; it said the server split guesses wrong.
- Task 10 moved the `autoApprove` ref from `session/config.ts` to `claude.ts:268-307`, where the config schema collapses the two axes onto `permissionMode`. The other refs point at their current lines.
- The sdk and server test files that push the rule sign in a person who holds `config:change`, because a root push needs that grant.

## Left for later

- The by-hand checks in the plan's *Final verification checklist* wait for a test daemon. Claude's steps 2 to 5 against the SDK are open, and so is an ACP agent asking once for a matched host tool.
- A session inside a machine does not read the rule yet. It waits for the computer work, and [deferred.md](deferred.md) says why.
- `packages/sdk/test/fixtures/wire.jsonl` was rewritten by the sdk suite, and its restore is denied here. Run `git checkout -- packages/sdk/test/fixtures/wire.jsonl` before committing anything else.
- The whole suite was not run. This build's rule named the package tests of each task, one command at a time.
