---
title: A turn the Claude session cannot begin is refused
status: done
depends: []
layer: claude
refs:
  - "[code://packages/agent-claude/src/session/turns.ts#L594-L596](../../../../packages/agent-claude/src/session/turns.ts#L594-L596) - `begin`"
  - "[code://packages/sdk/src/types/session.ts#L202-L203](../../../../packages/sdk/src/types/session.ts#L202-L203) - `SessionOptions.emit`, beside which `handed` goes"
---

## Objective

A turn that reaches the Claude session while a turn of that chat runs or is still beginning is refused to the client that sent it.

## Files

- `UPDATE: packages/sdk/src/types/session.ts:202-203` - `SessionOptions.handed`.
- `UPDATE: packages/agent-claude/src/claude.ts:717` - `start.handed` passed to the session.
- `UPDATE: packages/agent-claude/src/session/turns.ts:594-596` - `begin` refuses a turn while one runs or begins.
- `UPDATE: packages/agent-claude/src/session/turns.ts:203-212` - `beginTurn`'s comment, to what reaches it.
- `UPDATE: packages/sdk/test/host-turn.test.ts` - a turn sent while the one before it switches its model, refused to its sender.

## Steps

1. Write the case and run it on `cae062e6` to see the second turn answered with nothing.
2. Pass `handed` to the session, and refuse in `begin`.

## Validation

- The new case fails on `cae062e6` and passes after the change.
- `host-turn`, `host-senders`, `nested-proxy`, `echo-origin`, `policy-checks` and the agent-claude suites pass.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Resume

Done 2026-10-31.
Every step is built, and the touched suites, the type check and the boundary check pass.
