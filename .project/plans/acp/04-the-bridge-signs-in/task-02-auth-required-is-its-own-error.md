---
title: auth_required is its own error
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L634-L650](../../../../packages/agent-acp/src/session.ts#L634-L650) - how a failed turn ends"
---

## Objective

An ACP `auth_required` error on open or on a prompt ends the turn as `chat/error` with type `authRequired` and a sentence naming the server's methods and the `authenticate` option.

## Files

- `UPDATE: packages/agent-acp/src/session.ts`.

## Steps

1. Recognise the SDK's error code, keep the handshake's `authMethods` to name them.

## Validation

- A fixture answering `auth_required` gives that type and the method names.

## Resume
