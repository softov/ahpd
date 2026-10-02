---
title: A turn knows who sent it
status: done
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

Implemented 2026-10-02.

`host.ts` keeps `senders`, a map from a running turn's id to the `Owner` that asked for it, with `senderOf(turn)` reading it. `beginOrRun` takes a `sender` before its `queuedAs` and records it under `queuedAs ?? turnId`; all four call sites fill it from `ownerFor(connection)`, so a person who asks sends a turn as `user:<id>` and the deployment's own token sends one as `root:<host>`, exactly as a session it starts is owned. Host 33 task 01 has not landed, so there was nothing built already to use.

`emit` is where the answer is read, as the ref says. A queued message is recorded under the id the host gave it, which is the only id it has, and the backend names the turn it ran as - so a `chat/turnStarted` carrying `queuedMessageId` moves the sender onto `turnId` there, and `chat/turnComplete` / `chat/turnCancelled` let it go once what is wanted from it has been read. Nothing is kept for a session's history, where a usage record already has it.

One file outside the task's list: `packages/sdk/src/types/events.ts`, where `TurnStartEvent` and `TurnEndEvent` gained `sender?: Owner`. The task names the lookup but nothing to read it with, and the validation asks a host test to answer a turn's sender - a host-private map cannot be asserted from outside, and every other way of asking for it (a new `Host` method, a new field on a `Session` handle, a tool) is a larger public surface than the one the ref points at. `emit` already fires both events at the line the task names, so this is where the answer goes rather than a new place. The events file says adding to the union is a change to `@ahpd/sdk`; this is an optional field on two members, and a plugin that already reads them is unaffected.
