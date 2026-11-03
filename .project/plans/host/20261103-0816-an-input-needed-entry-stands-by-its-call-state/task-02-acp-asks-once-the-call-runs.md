---
title: ACP asks once the call runs
status: done
depends: [task-01-an-entry-stands-in-its-own-state.md]
layer: agent
refs:
  - "[code://packages/agent-acp/src/mapping.ts#L209-L221](../../../../packages/agent-acp/src/mapping.ts#L209-L221) - `running`"
  - "[code://packages/agent-acp/src/session/handlers.ts#L295-L308](../../../../packages/agent-acp/src/session/handlers.ts#L295-L308) - the emit loop"
---

## Objective

An ACP session asks a client to run a call once the chat holds that call running, which is after the ready that says so.

## Files

- `UPDATE: packages/agent-acp/src/types.ts:490-497` - the turn holds the calls waiting for their ready.
- `UPDATE: packages/agent-acp/src/mapping.ts:209-221` - `running` holds the call rather than asking at once.
- `UPDATE: packages/agent-acp/src/session/handlers.ts:295-308` - the held calls are asked for after the update's actions.
- `UPDATE: packages/agent-acp/src/session/turn.ts:336-358` - the turn opens with no call waiting.
- `UPDATE: packages/agent-acp/src/transcript.ts:50-58` - a replayed turn too.
- `UPDATE: packages/agent-acp/test/agent-acp-client-tool.test.ts:445-470` - the entry goes up after the ready.
- `UPDATE: packages/agent-acp/test/agent-acp-catalog.test.ts:1484-1535` - the turns the mapping cases build.

## Steps

1. Hold each client's call on the turn as the mapping readies it.
2. Ask for the held calls once the update's actions have gone out.
3. Open every turn with no call waiting.
4. Read the order in the client tool case.

## Validation

- `packages/agent-acp/test/agent-acp-client-tool.test.ts`: the order fails on `cde4dd6c` and passes after.
- The ACP client tool, catalog and ports test files pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-03.

- On `cde4dd6c`'s sources the order fails: the entry goes up before the ready.
