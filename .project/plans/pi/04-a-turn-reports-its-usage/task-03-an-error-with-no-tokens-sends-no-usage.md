---
title: A turn that failed before any token sends no usage
status: done
depends: [task-01-a-turn-sends-its-usage.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L76-L95](../../../../packages/agent-pi/src/session.ts#L76-L95) - `usageOf`"
---

## Objective

A turn whose last assistant message is an error with every count at zero sends no `chat/usage`, as a turn with no assistant message does.

## Files

- `UPDATE: packages/agent-pi/src/session.ts`
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the case below.

## Steps

1. Leave usage out when the last message's `stopReason` is `error` and its input, output and cache counts are all zero.

## Validation

- Seen live on 2026-09-27: a 401 from the provider sent `chat/usage` with zeros before `chat/error`.
- `packages/agent-pi/test/agent-pi.test.ts`: that message ends the turn with `chat/error` and no `chat/usage`.
- `node_modules/.bin/vitest run packages/agent-pi` green.

## Resume

Built.
`session.ts`'s `usageOf` leaves the usage out when the last assistant message's `stopReason` is `error` and its input, output and cache counts are all zero, so a provider failure before any token ends the turn with `chat/error` and no `chat/usage`.

- Failed first: the case saw `chat/usage` before the `chat/error`.
- `node_modules/.bin/vitest run packages/agent-pi` green, 88 tests; `pnpm typecheck` green.
