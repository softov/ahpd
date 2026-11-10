---
title: send_message replaces, cancels and steers
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/tools/session.ts#L682-L711](../../../../packages/sdk/src/tools/session.ts#L682-L711) - `send_message`"
---

## Objective

`send_message` takes VS Code's `operation`, `delivery`, `messageId` and `expectedRevision`, and answers a sent message's id and revision.

## Files

- `UPDATE: packages/sdk/src/tools/session.ts:682-711` - the inputs, the text and the run.
- `UPDATE: packages/sdk/test` - a case for each operation and delivery.
- `UPDATE: docs/server/MCP.md` - the new inputs.

## Steps

1. Copy VS Code's `send_message` schema and description at 171e90619.
2. Send a `steer` delivery as the host's steering message of the chat's running turn.
3. Send a `queue` delivery as a queued message, as today, and answer its id and revision.
4. Make `replace` and `cancel` act only on a queued message this chat sent, at the revision given.
5. Refuse in VS Code's words where VS Code refuses.

## Validation

- A case for `steer` on a running turn, `replace` and `cancel` of a queued message, and a stale `expectedRevision`.
- `pnpm typecheck`, then the sdk suite.

## Resume

