---
title: A tool result is said as the client sent it - implemented
date: 2026-11-03
refs:
  - git://7fef3441 - the change
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
---

The comment on a client's tool result says the client's own action answers it, once the backend takes it.
The completion the harness reports after it is dropped, and `answeredBy`'s comment names what a backend still owes: a turn begun or a message queued.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - the comment on `chat/toolCallComplete`.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - the comment on `answeredBy`.

## Verified

- No behavior moved, so no case changed.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.
