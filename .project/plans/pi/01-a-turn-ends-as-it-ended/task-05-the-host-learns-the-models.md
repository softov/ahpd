---
title: The host learns pi's models once pi has listed them
status: done
depends: [task-03-the-configured-model-is-the-default.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L570-L637](../../../../packages/agent-pi/src/session.ts#L570-L637) - `build`, which lists the models and says so on the first open"
  - "[code://packages/agent-claude/src/session.ts#L2348](../../../../packages/agent-claude/src/session.ts#L2348) - the sibling calls `onHandshake` once it has described itself"
  - "[code://packages/sdk/src/host.ts#L2050-L2067](../../../../packages/sdk/src/host.ts#L2050-L2067) - `learnModels`, which reads `Session.models()` and broadcasts `root/agentsChanged`"
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L219](../../../../packages/agent-pi/test/agent-pi.test.ts#L219) - the case"
---

## Objective

A pi session tells the host once pi has opened and listed its models, so the host learns them and a client's model picker shows pi's models, as it does for Claude.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:570-637` - the first `build` calls `start.onHandshake?.()` after the models are listed.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the case below.

## Steps

1. After the first open lists its models and applies the configured model and any rewind, call `start.onHandshake?.()`.
2. A rebuild after the tools change lists the same models and does not call it again.

## Validation

- `tells the host once pi has listed its models, and only once`: two turns, one handshake, and `session.models()` already holds pi's models when it fires.
- It failed first with "expected [] to deeply equal [ [ 'anthropic/claude-opus-5', …(1) ] ]".
- `node_modules/.bin/vitest run packages/agent-pi` green.

## Resume

Built in review, 2026-09-27.
The first `build` calls `start.onHandshake?.()` at the end of its first-open block, so a refused rewind that fails the open does not announce it and the retry does.
`node_modules/.bin/vitest run packages/agent-pi` green, 92 tests; `pnpm typecheck` green.
