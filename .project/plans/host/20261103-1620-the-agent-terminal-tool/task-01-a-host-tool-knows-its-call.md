---
title: A host tool knows its call
status: implemented
depends: []
layer: "@ahpd/sdk, @ahpd/agent-claude, @ahpd/agent-pi, @ahpd/agent-cofold"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L82-L120](../../../../packages/sdk/src/types/agent.ts#L82-L120) - `BoundTool`"
  - "[code://packages/sdk/src/types/host.ts#L981-L1318](../../../../packages/sdk/src/types/host.ts#L981-L1318) - `HostToolCommon` and `ToolCall`"
  - "[code://packages/sdk/src/host/tooling.ts#L2248-L2283](../../../../packages/sdk/src/host/tooling.ts#L2248-L2283) - `offeredTools`"
  - "[code://packages/sdk/src/types/session.ts#L390-L418](../../../../packages/sdk/src/types/session.ts#L390-L418) - `CommandTerminal` and `RunCommand`, the shape to copy"
  - "[code://packages/agent-claude/src/session/turns.ts#L619-L637](../../../../packages/agent-claude/src/session/turns.ts#L619-L637) - `terminalOf` and the content change a `!` call sends"
  - "[code://packages/agent-claude/src/session/clienttools.ts#L38-L132](../../../../packages/agent-claude/src/session/clienttools.ts#L38-L132) - `namedBy`, which reads the call id"
  - "[code://packages/agent-claude/src/session/query.ts#L127-L131](../../../../packages/agent-claude/src/session/query.ts#L127-L131) - `denyOption`"
  - "[code://packages/agent-claude/src/session/asking.ts#L568-L575](../../../../packages/agent-claude/src/session/asking.ts#L568-L575) - the approval rules for `Bash`"
  - "[code://packages/agent-pi/src/tools.ts#L26-L110](../../../../packages/agent-pi/src/tools.ts#L26-L110) - `PI_TOOLS` and `execute`"
  - "[code://packages/agent-pi/src/session.ts#L1363-L1379](../../../../packages/agent-pi/src/session.ts#L1363-L1379) - pi's `terminalOf` and its content change"
  - "[code://packages/agent-cofold/src/tools.ts#L121-L143](../../../../packages/agent-cofold/src/tools.ts#L121-L143) - `cofoldTool.execute` and `ctx.callId`"
  - "[code://packages/agent-cofold/src/turns.ts#L724-L833](../../../../packages/agent-cofold/src/turns.ts#L724-L833) - cofold's `!` call and its content change"
  - git://e7ada61c - the fork's call id, `overridesBuiltInTool`, and its Claude and pi changes
---

## Objective

A host tool's `run` gets the call's id and an `opened` callback from the backend that runs it.
When the tool opens a terminal for the call, the backend puts the terminal on its call and sends `chat/toolCallContentChanged`, as for a `!` call.
A host tool can carry `overridesBuiltInTool`, and then Claude and pi use it in place of their own tool of that name.

## Files

- `UPDATE: packages/sdk/src/types/agent.ts:82-120` - `BoundTool.run(input, call?)` with `{ toolCallId, opened? }`, and `overridesBuiltInTool`.
- `UPDATE: packages/sdk/src/types/host.ts:981-1318` - `overridesBuiltInTool` on `HostToolCommon`, and `toolCallId` and `opened` on `ToolCall`.
- `UPDATE: packages/sdk/src/host/tooling.ts:2248-2283` - `offeredTools` passes the call into the tool's `ToolCall`, and copies the mark.
- `UPDATE: packages/agent-claude/src/session/clienttools.ts:62-132` - a host tool gets the id from `namedBy(extra)` and an `opened` that writes the terminal on the call.
- `UPDATE: packages/agent-claude/src/session/query.ts:127-131` - with a marked `bash` offered, disallow `Bash` and set `toolAliases: { Bash: 'mcp__ahp__bash' }`.
- `UPDATE: packages/agent-claude/src/session/asking.ts:568-575` - `mcp__ahp__bash` lines go through the approval rules as `Bash` lines.
- `UPDATE: packages/agent-pi/src/tools.ts:26-110` - keep a marked host tool of a `PI_TOOLS` name, and pass the id and `opened`.
- `UPDATE: packages/agent-cofold/src/tools.ts:121-143` - pass `ctx.callId` and `opened`.
- `UPDATE: packages/agent-claude/test/`, `packages/agent-pi/test/`, `packages/agent-cofold/test/` - one case each, from the fork's tests.

## Steps

1. Add the call argument to `BoundTool.run` and `toolCallId` and `opened` to `ToolCall`.
2. Add `overridesBuiltInTool` to `HostToolCommon` and `BoundTool`, and copy it in `offeredTools`.
3. Pass the call from `offeredTools` into the `ToolCall` the tool gets.
4. In Claude, read the id with `namedBy(extra)` for a host tool, as for a client tool.
5. In Claude, write the terminal on the call in `opened`, with the block `terminalOf` builds for a `!` call.
6. In Claude, disallow `Bash` and set `toolAliases` when the offer has a marked `bash`.
7. In Claude, check `mcp__ahp__bash` lines against the approval rules.
8. In pi, keep a marked host tool of a `PI_TOOLS` name, and pass the id and `opened`.
9. In cofold, pass `ctx.callId` and an `opened` that writes the terminal on the call.
10. Write one test for each backend.

## Validation

- Claude test: a host tool's `run` gets the `claudecode/toolUseId` of the call.
- Claude test: `opened` puts a `terminal` block on the call, and a `chat/toolCallContentChanged` goes out before the completion.
- Claude test: a marked `bash` makes the query options disallow `Bash` and alias it.
- Claude test: an `mcp__ahp__bash` line that a rule approves runs with no question.
- pi test: a marked host `bash` replaces pi's own, and an unmarked one is still dropped.
- cofold test: a host tool gets `ctx.callId`.
- `pnpm typecheck` and each backend's suite pass, one at a time.

## Resume

Implemented on `build/agents/09cc9b8d`, one commit for this task.

- **SDK:** `BoundTool.run(input, call?)` takes `ToolCallFacts { toolCallId?, opened? }`; `HostToolCommon` and `BoundTool` carry `overridesBuiltInTool`; `ToolCall` carries `toolCallId` and `opened`; `offeredTools` copies the mark and passes the call through `toolContext`.
- **Claude:** `clienttools.ts` reads `claudecode/toolUseId` for a host tool and gives it an `opened` that puts a `terminal` block on the call and emits `chat/toolCallContentChanged`; `openedTerminals` carries that block into the completion in `stream.ts`. `options.ts`/`query.ts` disallow `Bash` and alias it to `mcp__ahp__bash` when a marked `bash` is offered. `asking.ts` reads `mcp__ahp__bash` lines by the terminal rules as `Bash` lines.
- **pi:** `tools.ts` keeps a marked host tool of a `PI_TOOLS` name, passes the call id and `opened`; `session.ts` opens the terminal on the call; `mapping.ts` keeps terminal blocks in the completion.
- **cofold:** `tools.ts` passes `ctx.callId` and `opened`; `mapping.ts` and `turnagent.ts` put the terminal on the call and carry it into the completion.
- **Tests:** `packages/agent-claude/test/agent-claude-host-shell-tool.test.ts` (4 cases), one case in `packages/agent-pi/test/agent-pi-tools.test.ts`, one in `packages/agent-cofold/test/agent-cofold-tools.test.ts`.
- **Gates:** `pnpm build`, `pnpm exec tsc -p tsconfig.json --noEmit`, `pnpm boundary`, `pnpm --filter @ahpd/sdk test` (218 files, 4141 passed), and the agent-claude (57 files, 538 passed), agent-pi (18 files, 251 passed), agent-cofold (18 files, 280 passed) and agent-acp (20 files, 295 passed) suites all pass.
- **Not done:** `git checkout -- packages/sdk/test/fixtures/wire.jsonl` is denied in this session, so the fixture stays dirty with what the suite wrote; restore it before committing anything else.
