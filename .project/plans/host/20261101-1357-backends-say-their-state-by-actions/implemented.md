---
title: Backends say their state by actions - implemented
date: 2026-11-01
refs:
  - git://30eb6dd1
  - "[code://examples/echo/agent.ts](../../../../examples/echo/agent.ts)"
  - "[code://packages/agent-cofold/src/runs.ts](../../../../packages/agent-cofold/src/runs.ts)"
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts)"
---

Three backends now say a change to a chat as an action, so the host's held state carries it to every client.
The echo backend's turns carry their attachments, and a resumed cofold run shows its open turn once.
A reopened nested session shows its title and its turns.

## What was built

- [`code://examples/echo/agent.ts`](../../../../examples/echo/agent.ts) - `beginTurn` puts the attachments it was handed on the turn's message, from `begin`, `queue` and `startNext`.
- [`code://packages/agent-cofold/src/runs.ts`](../../../../packages/agent-cofold/src/runs.ts) - `reopen` emits `chat/truncated` back to the turn before the seeded copy it drops.
- [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts) - `bringUp` emits `session/titleChanged`, and `chat/truncated` then `chat/turnsLoaded`, when the inner session moved.

## Verified

- `host-attachments.test.ts` failed without the echo change, on a turn with no attachments, and passes 9 of 9 with it.
- `agent-cofold-plugin.test.ts` failed without the cofold change, with the open turn twice, and passes with it.
- `nested-proxy.test.ts` and `nodes.test.ts` failed a case each without the proxy change, and pass 71 of 71 with it.
- The full unit run at two workers passes 7351 of 7352, and the process run 695 of 695.

## Departures from the plan

- None.

## Left for later

- The backend sites the audit names beside these three, in [deferred.md](deferred.md).
