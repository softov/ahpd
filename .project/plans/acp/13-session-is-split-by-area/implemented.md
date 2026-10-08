---
title: session.ts is split into one file per area - implemented
date: 2026-10-04
refs:
  - "[code://packages/agent-acp/src/session.ts](../../../../packages/agent-acp/src/session.ts) - composes the areas"
  - "[code://packages/agent-acp/src/session/context.ts](../../../../packages/agent-acp/src/session/context.ts) - the shared state every area reads"
---

`packages/agent-acp/src/session.ts` went from 2,105 lines to 321, and each area is a file of its own under `packages/agent-acp/src/session/`.

## What was built

- `session/context.ts` - one `SessionContext`, built once in `acpSession`; a `let` more than one area reads is a field on it.
- `session/common.ts`, `config.ts` (config and models), `handlers.ts` (what the server sends), `opening.ts`, `turn.ts` (a prompted turn) and `queue.ts` (the queue and the shell turn), none over 452 lines.

## Verified

- A pure move: the old file's lines, with `ctx.` and imports set aside, are all in the new files; what is new is the context type, the factories and their wiring.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (186 files, 2,839 tests, the count before the split) pass.

## Departures from the plan

- The funnel is inside the `ctx` literal, and the literal is cast `as unknown as SessionContext` (tasks 01 and 02).
- `setConfig` and `ran` are typed `NonNullable` (task 06).
- `begin` is `ctx.begin` itself, not a five-argument wrapper. The `Session` type still stops a sixth argument.

## Left for later

- The tasks stay `implemented` until Softov reviews them.
