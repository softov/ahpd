---
title: A turn asked for while one runs is refused
status: todo
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/lifecycle.ts](../../../../packages/sdk/src/host/lifecycle.ts) - `beginOrRun`, one turn at a time"
---

## Objective

A `chat/turnStarted` sent while the chat runs a turn is refused, a command's as much as a question's.
A message that waits its turn is a queued message.

## Files

- `UPDATE: packages/sdk/src/host/lifecycle.ts` - the one-turn check covers a command.
- `UPDATE: packages/sdk/test/host-terminals.test.ts` - a command sent as a turn while a turn runs is refused, and one queued runs after it.

## Steps

1. Refuse a turn while the chat holds an active turn, whatever its text.
2. Keep a queued command on the road it takes now.

## Validation

- `pnpm exec vitest run packages/sdk/test/host-terminals.test.ts` - passes; the new case fails on c3c8c3e4.
