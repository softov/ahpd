---
title: A config change is answered once
status: todo
depends: [task-01-an-action-is-answered-on-its-own-channel.md]
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - `session/configChanged`"
---

## Objective

A `session/configChanged` is answered by one action carrying every key as it was taken, or by one refusal.
A refusal puts back each key taken before it, in the backend and in the session's config.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts` - the keys are checked first, the backend is asked one key at a time, and one answer goes out.
- `UPDATE: packages/sdk/test/echo-origin.test.ts` - two keys are answered once, and an unchanged fixed key is answered.

## Steps

1. Refuse the whole action for a key of the wrong shape.
2. Refuse the whole action for a fixed key that moved after the first turn.
3. Refuse the whole action for a key that the backend takes no config for.
4. Ask the backend for each other key in order.
5. When the backend refuses a key, give back each key it took before.
6. Say one action with each key as the session holds it.
7. Say a key that the backend took under its own keys as those keys.
8. After a restart, answer every key as the session holds it.

## Validation

- `pnpm exec vitest run packages/sdk/test/echo-origin.test.ts` - passes; the new cases fail on c3c8c3e4.
