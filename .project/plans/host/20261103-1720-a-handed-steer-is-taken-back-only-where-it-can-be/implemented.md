---
title: A handed steer is taken back only where it can be - implemented
date: 2026-11-03
refs:
  - git://04929f54 - the change
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
  - "[code://packages/sdk/src/types/session.ts](../../../../packages/sdk/src/types/session.ts)"
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts)"
---

A removal of the steering message while a turn runs is refused before the backend hears of it, unless the backend has `withdraw`.
Claude, cofold and pi have none, so a steer they were handed runs, and every client shows it until it is taken in.
The proxy's `withdraw` carries the removal to the host inside, which answers it.

## What was built

- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - an optional `withdraw`, and `unqueue`'s reach while no turn runs.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - the check before the backend is asked, and the host's answer for a backend that took a steer back silently.
- [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts) - `withdraw`, carried inside.
- Claude's and cofold's comments on what reaches `unqueue`; AHP.md's and CHATS.md's removal rows.
- Two host cases, cofold's held-steer case extended, and the nested case's inner backend given `withdraw`.

## Verified

- On `3945964a`'s sources the two host cases fail: the backend's `unqueue` is asked before the refusal, and a backend that can withdraw is refused.
- There cofold's chat still shows the steer after its run read it, and the nested case's host inside refuses the removal.
- With the change, `host-steering` passes 7 of 7, `agent-cofold-turn` 45 of 45 and `nested-proxy` 69 of 69, one file at a time.
- `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.

## Departures from the plan

None.
