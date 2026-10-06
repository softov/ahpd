---
title: A queued or steering message carries its attachments
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/session.ts#L364](../../../../packages/sdk/src/types/session.ts#L364) - `steer`"
  - "[code://packages/sdk/src/types/session.ts#L412](../../../../packages/sdk/src/types/session.ts#L412) - `queue`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L775-L776](../../../../packages/sdk/src/host/lifecycle.ts#L775-L776) - `queue` called without them"
  - "[code://packages/sdk/src/host/chatactions.ts#L847](../../../../packages/sdk/src/host/chatactions.ts#L847) - `steer` called with text only"
---

## Objective

`Session.queue` and `Session.steer` take an optional `attachments` after their existing parameters, documented as `begin`'s is, and the host passes the message's attachments to both.

## Files

- `UPDATE: packages/sdk/src/types/session.ts:364` and `:412`.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:776`.
- `UPDATE: packages/sdk/src/host/chatactions.ts:847` - `messageAttachments(message)`.

## Steps

1. Optional, so every backend compiles unchanged until its own plan takes them.

## Validation

- A host test with a scripted session reads the attachments `queue` and `steer` were given.

## Resume
