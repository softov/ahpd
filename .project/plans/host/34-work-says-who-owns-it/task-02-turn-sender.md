---
title: A turn knows who sent it
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L4906-L4907](../../../../packages/sdk/src/host.ts#L4906-L4907) - the message is forwarded to `session.begin/queue`"
  - "[code://packages/sdk/src/host.ts#L3575-L3576](../../../../packages/sdk/src/host.ts#L3575-L3576) - a session's `emit`, where usage will be read"
---

## Objective

The host keeps, per active turn, the person who sent it, and can answer it wherever the turn's actions pass through `emit`.

## Files

- `UPDATE: packages/sdk/src/host.ts:4906-4907` - record `sender: 'user:<id>'` for the turn id when a message starts or is queued.
- `UPDATE: packages/sdk/src/host.ts:3575-3576` - a lookup from turn id to sender, for the usage meter later.

## Steps

1. A turn an automation starts takes the automation's owner (task 03).
2. If host 33 task 01 has landed, use what it built instead.

## Validation

- A host test: two people send turns in one session, and each turn answers its own sender.
- `pnpm -F @ahpd/sdk test`.

## Resume
