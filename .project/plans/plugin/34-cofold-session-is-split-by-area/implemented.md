---
title: The cofold session is split into one file per area, and session.ts composes them - implemented
date: 2026-10-04
refs:
  - "[code://packages/agent-cofold/src/session.ts](../../../../packages/agent-cofold/src/session.ts) - composes the areas"
  - "[code://packages/agent-cofold/src/context.ts](../../../../packages/agent-cofold/src/context.ts) - the shared state every area reads"
---

`packages/agent-cofold/src/session.ts` went from 1,558 lines to 370, and each area is a file of its own beside it.

## What was built

- `context.ts` - one `SessionContext`, built once in `cofoldSession`.
- `turnagent.ts` (the turn agent), `runs.ts` (reading a run), `pauses.ts` (a paused run's answers) and `turns.ts` (opening a turn and the queue), none over 418 lines.
- Each file that reads `bag` or `str` keeps its own copy, as `transcript.ts` already did.

## Verified

- A pure move: the old file's lines, with `ctx.` and imports set aside, are all in the new files; what is new is the context type, the factories, their wiring and the `bag` and `str` copies.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.

## Departures from the plan

- Task 03 put `owePause`, `payPause` and `startNext` on `SessionContext` before their own tasks landed, as plain function fields.

## Left for later

- The tasks stay `implemented` until Softov reviews them.
