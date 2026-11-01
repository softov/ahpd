---
title: The nested proxy says a reopened session
status: todo
depends: []
layer: "sdk sessions"
refs:
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts) - `bringUp`, which reads the inner session's snapshot into the mirror"
  - "[code://packages/sdk/test/nested-proxy.test.ts](../../../../packages/sdk/test/nested-proxy.test.ts) - the reopened session a client reads"
---

## Objective

A nested session whose inner host is reopened says the title and the turns it reopened with, so every client holds them.

## Files

- `UPDATE: packages/sdk/src/sessions/nested.ts` - `bringUp` emits `session/titleChanged` and the chat's `chat/truncated` and `chat/turnsLoaded` when they moved.

## Steps

1. Keep the title and the turns the mirror held before `bringUp` reads the inner snapshot.
2. Emit `session/titleChanged` when the inner title differs.
3. Emit `chat/truncated` and then `chat/turnsLoaded` when the inner turns differ.

## Validation

- Run `nested-proxy.test.ts` and `nodes.test.ts` without the change: a case in each fails.
- The two cases are the truncate of a nested session and the hub started again.
- Run both with the change: they pass 71 of 71.

## Resume

Not started.
