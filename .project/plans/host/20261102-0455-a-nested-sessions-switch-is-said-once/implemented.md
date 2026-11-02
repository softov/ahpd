---
title: A nested session's switch is said once - implemented
date: 2026-11-02
refs:
  - git://2f3224d7
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts)"
---

A switch, a setting or an answer the host outside says itself reaches its clients once on a nested session.

## What was built

- [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts) - `saidOutside` keeps the `clientSeq` of each action the host outside says itself.
- `deliver` takes the mark, and `answer`, `setConfig` and `setCustomizationEnabled` deliver with it.
- `pump` takes a marked echo into the mirror and emits nothing.
- [`code://packages/sdk/test/nested-proxy.test.ts`](../../../../packages/sdk/test/nested-proxy.test.ts) - the inner session publishes a plugin, and a client outside switches it.

## Verified

- The client outside gets one `session/customizationToggled`, under its `clientSeq` 9.
- On main's `nested.ts` the case fails: a second copy follows, with no origin.
- `nested-proxy` 62 tests, `nested-process` 14 and `nested-background-tasks` 3 pass; `pnpm typecheck` exits 0.

## Departures from the plan

- none.

## Left for later

- none.
