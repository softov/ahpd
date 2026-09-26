---
title: A resume does not replay what the host holds
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L483-L547](../../../../packages/agent-acp/src/session.ts#L483-L547) - `open`, where a resume is always `session/load`"
  - "[code://packages/agent-acp/src/connection.ts#L149](../../../../packages/agent-acp/src/connection.ts#L149) - `loadSession`, beside which `resumeSession` goes"
  - "[code://packages/sdk/src/types/agent.ts#L181-L196](../../../../packages/sdk/src/types/agent.ts#L181-L196) - `Start.resume` and `Start.seed`"
  - "[code://test/agent-acp.test.ts](../../../../test/agent-acp.test.ts) - the scripted server the bridge is tested against"
---

## Objective

A resumed ACP session whose turns the host already holds is resumed with `session/resume`, and every other resume is `session/load` as today.

## Files

- `UPDATE: packages/agent-acp/src/connection.ts:149` - `resumeSession` on the connection.
- `UPDATE: packages/agent-acp/src/session.ts:483-547` - the choice between the two calls.
- `UPDATE: test/agent-acp.test.ts` - the cases below.

## Steps

1. Read whether the server advertised `session.resume` in the `initialize` answer.
2. When it did and `Start.seed` is not empty, call `resumeSession` with the same `sessionId`, `cwd`, `mcpServers` and `additionalDirectories` `loadSession` is given, and learn modes and config options from its answer.
3. Otherwise keep the `loadSession` path and its refusal unchanged.
4. Rewrite the comment above `open` to say which call is made when.

## Validation

- `test/agent-acp.test.ts`: a server advertising `session.resume`, with a seed, gets `session/resume` and no `session/load`; without a seed it gets `session/load`; a server advertising neither refuses as today.
- `pnpm test`, `pnpm typecheck` green.

## Resume

