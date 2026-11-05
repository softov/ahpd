---
title: A stop takes every steer and starts nothing - implemented
date: 2026-11-03
refs:
  - git://a0092792 - the change
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
  - "[code://packages/sdk/src/types/session.ts](../../../../packages/sdk/src/types/session.ts)"
---

A turn that ends cancelled takes every steering message its chat holds with it, and starts nothing.
The host calls the backend's `clearSteering`, and takes the shown steering message out itself for a backend without one.
Claude, cofold, pi and the bot let go of every steering message their agent has not taken in, saying each one gone.

## What was built

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - the cancelled-end hook calls `clearSteering`, with no take-back.
- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - an optional `clearSteering`.
- [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts) - Claude's, for its queue's steering and the steers its CLI has not read.
- [`code://packages/agent-cofold/src/session.ts`](../../../../packages/agent-cofold/src/session.ts) - cofold's, with a set of unsettled submits that stay silent once let go of.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - pi's, with the runtime clear moved here from `cancel`.
- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - the bot's; the proxy's in `nested.ts`, left to the host inside.
- AHP.md's stop row, CHATS.md's Claude and cofold lines, cofold's README.

## Verified

- On `3945964a`'s sources the four new cases fail.
- There the stop calls the backend's `unqueue` for the shown message, and Claude and cofold keep their other steering messages.
- With the change, `host-steering` passes 7 of 7 and `agent-claude-late-steer` 20 of 20, one file at a time.
- So do `agent-cofold-turn`, 46 of 46, and `agent-pi-steering`, 2 of 2.
- `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.

## Departures from the plan

- The bot's `clearSteering` has no case of its own, since its tests build a whole plugin host.
- Its road is the host's, which the host cases drive.
