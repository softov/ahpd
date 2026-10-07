---
title: A queued or steering message carries its attachments
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/session.ts#L368](../../../../packages/sdk/src/types/session.ts#L368) - `steer`, which took text only"
  - "[code://packages/sdk/src/types/session.ts#L420](../../../../packages/sdk/src/types/session.ts#L420) - `queue`, which took no attachments"
  - "[code://packages/sdk/src/host/lifecycle.ts#L901-L902](../../../../packages/sdk/src/host/lifecycle.ts#L901-L902) - where `begin` and `queue` are called"
  - "[code://packages/sdk/src/host/chatactions.ts#L946-L958](../../../../packages/sdk/src/host/chatactions.ts#L946-L958) - where `steer` and `beginOrRun` are called for a pending message"
---

## Objective

`Session.queue` and `Session.steer` take an optional `attachments` after their existing parameters, documented as `begin`'s is, and the host passes the message's attachments to both.

## Files

- `UPDATE: packages/sdk/src/types/session.ts:368` and `:420`.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:902`.
- `UPDATE: packages/sdk/src/host/chatactions.ts:946` and `:958` - `messageAttachments(message)`.

## Steps

1. Optional, so every backend compiles unchanged until its own plan takes them.

## Validation

- A host test with a scripted session reads the attachments that `queue` and `steer` received.

## Resume
