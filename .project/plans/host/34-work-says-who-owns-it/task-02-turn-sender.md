---
title: A turn knows who sent it
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L9238](../../../../packages/sdk/src/host.ts#L9238) - the message is forwarded to `session.begin/queue`"
  - "[code://packages/sdk/src/host.ts#L3573-L3574](../../../../packages/sdk/src/host.ts#L3573-L3574) - a session's `emit`, where usage will be read"
---

## Objective

The host keeps, per active turn, the person who sent it, and can answer it wherever the turn's actions pass through `emit`.

## Files

- `UPDATE: packages/sdk/src/host.ts:9238` - record `sender: 'user:<id>'` for the turn id when a message starts or is queued.
- `UPDATE: packages/sdk/src/host.ts:3573-3574` - a lookup from turn id to sender, for the usage meter later.

## Steps

1. A turn an automation starts takes the automation's owner (task 03).
2. If host 33 task 01 has landed, use what it built instead.

## Validation

- A host test: two people send turns in one session, and each turn answers its own sender.
- `pnpm -F @ahpd/sdk test`.

## Resume
