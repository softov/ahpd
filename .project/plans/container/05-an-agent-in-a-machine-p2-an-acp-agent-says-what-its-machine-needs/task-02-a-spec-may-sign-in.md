---
title: A spec may sign in after initialize
status: dropped
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L526-L547](../../../../packages/agent-acp/src/session.ts#L526-L547) - the handshake"
  - npm://@agentclientprotocol/sdk - `authenticate`, `AuthMethod`
---

## Objective

With `authenticate: { methodId: "api-key", _meta: {...} }`, the bridge sends `authenticate` after `initialize` when the server's `authMethods` lists that id, and says in a sentence when it does not.

## Files

- `UPDATE: packages/agent-acp/src/types.ts` - `AcpOptions.authenticate`.
- `UPDATE: packages/agent-acp/src/plugin.ts` - read it.
- `UPDATE: packages/agent-acp/src/session.ts:526-547` - the call between the two.
- `UPDATE: packages/agent-acp/test/` fixture ACP server - a mode that refuses `session/new` until signed in.

## Steps

1. After `initialize`, if the option is set, find the method in `handshake.authMethods`.
2. Listed: `await connection.authenticate({ methodId, _meta })`; a failure ends the start with the server's message.
3. Not listed: the start fails with "`<provider>` offers <ids>, not <methodId>".
4. No option: unchanged.

## Validation

- A fixture server that requires sign-in starts a session with the option and refuses without it.
- A method the server does not list fails with the ids in the sentence.

## Resume

Dropped 2026-09-26 before it started: moved to [acp 04 task 01](../../acp/04-the-bridge-signs-in/task-01-a-spec-may-sign-in.md), by Softov's answer that sign-in lives in the acp domain.
