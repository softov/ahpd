---
title: A spec may sign in after initialize
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L526-L547](../../../../packages/agent-acp/src/session.ts#L526-L547) - the handshake"
  - "[code://packages/agent-acp/src/plugin.ts#L61-L86](../../../../packages/agent-acp/src/plugin.ts#L61-L86) - `optionsOf`"
---

## Objective

With `authenticate: { methodId, _meta? }`, the bridge sends `authenticate` after `initialize` when the reply's `authMethods` lists that id, and fails the start naming the offered ids when it does not.

## Files

- `UPDATE: packages/agent-acp/src/types.ts` - `AcpOptions.authenticate`.
- `UPDATE: packages/agent-acp/src/plugin.ts` - read it, refusing a malformed one at load.
- `UPDATE: packages/agent-acp/src/session.ts:526-547` - the call.
- `UPDATE: packages/agent-acp/test/` fixture - a mode that refuses `session/new` until signed in.

## Steps

1. No option: unchanged.
2. Listed: `authenticate`; a failure ends the start with the server's message.
3. Not listed: `<provider> offers <ids>, not <methodId>`.

## Validation

- A fixture that requires sign-in starts with the option and refuses without it.

## Resume
