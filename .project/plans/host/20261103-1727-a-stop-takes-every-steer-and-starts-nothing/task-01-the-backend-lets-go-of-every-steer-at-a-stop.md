---
title: The backend lets go of every steer at a stop
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - the cancelled-end hook"
  - "[code://packages/sdk/src/types/session.ts](../../../../packages/sdk/src/types/session.ts) - `clearSteering`"
---

## Objective

A cancelled end calls the backend's `clearSteering`, and never its `unqueue`.
Each steering backend lets go of every steering message its agent has not taken in, and starts nothing.
A backend without `clearSteering` has the shown steering message taken out by the host.

## Files

- `UPDATE: packages/sdk/src/host.ts` - the hook.
- `UPDATE: packages/sdk/src/types/session.ts` - `clearSteering`.
- `UPDATE: packages/sdk/src/sessions/nested.ts` - the proxy's, which leaves it to the host inside.
- `UPDATE: packages/agent-claude/src/session/turns.ts` - Claude's: its queue's steering and the steers its CLI has not read.
- `UPDATE: packages/agent-cofold/src/session.ts` - cofold's: the steers its run holds, its handed-back steers and its queue's.
- `UPDATE: packages/agent-pi/src/session.ts` - pi's: its runtime's steering and its queue's.
- `UPDATE: packages/bot/src/chat.ts` - the bot's: its queue's steering.
- `UPDATE: docs/sdk/AHP.md`, `docs/sdk/CHATS.md`, `packages/agent-cofold/README.md` - the stop's steering.
- `UPDATE:` two host cases, a Claude case and a cofold case.

## Steps

1. Add an optional `clearSteering` to `Session`.
2. Call it from the cancelled-end hook, and take the shown steering message out where it is missing.
3. Implement it in Claude, cofold, pi and the bot, saying each removal and starting nothing.
4. Track cofold's unsettled submits, so each one a stop let go of stays silent.
5. Move pi's runtime clear from `cancel` into `clearSteering`.
6. Leave the proxy's empty, since the host inside clears at its own stop.
7. Add the host cases, and a case in Claude and cofold with several steering messages.

## Validation

- The new cases fail on `3945964a`'s sources and pass after.
- The test files that hold them pass, one file at a time, with pi's steering file.
- `pnpm run typecheck` and `pnpm run boundary` are clean.
