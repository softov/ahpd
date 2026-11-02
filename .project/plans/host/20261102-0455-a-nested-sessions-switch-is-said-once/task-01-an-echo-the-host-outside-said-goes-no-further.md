---
title: An echo the host outside said goes no further
status: todo
depends: []
layer: "sdk sessions"
refs:
  - "[code://packages/sdk/src/sessions/nested.ts#L510-L531](../../../../packages/sdk/src/sessions/nested.ts#L510-L531) - `deliver`"
  - "[code://packages/sdk/src/sessions/nested.ts#L933-L983](../../../../packages/sdk/src/sessions/nested.ts#L933-L983) - `pump`"
---

## Objective

The proxy keeps the `clientSeq` of each action the host outside says itself.
Its echo from the host inside moves the mirror and is not emitted.

## Files

- `UPDATE: packages/sdk/src/sessions/nested.ts:483` - `saidOutside`, the `clientSeq`s of the marked actions.
- `UPDATE: packages/sdk/src/sessions/nested.ts:510-531` - `deliver` takes the mark.
- `UPDATE: packages/sdk/src/sessions/nested.ts:933-983` - `pump` reduces a marked echo and emits nothing.
- `UPDATE: packages/sdk/src/sessions/nested.ts:1361-1393` - `answer`, `setConfig` and `setCustomizationEnabled` deliver with the mark.
- `UPDATE: packages/sdk/test/nested-proxy.test.ts` - a switch on a nested session, heard once outside.

## Steps

1. Add `saidOutside`, and a mark on `deliver` that keeps the sent `clientSeq`.
2. Mark the answer, the setting and the switch.
3. In `pump`, take a marked echo into the mirror and stop before the emit.
4. Write the case: the inner session publishes a plugin, and a client outside switches it.
5. Run the case against main's `nested.ts`.

## Validation

- The client outside gets one `session/customizationToggled`, under `clientSeq` 9.
- On main's `nested.ts` it gets two, the second with no origin.
- `nested-proxy`, `nested-process` and `nested-background-tasks` pass; `pnpm typecheck` exits 0.

## Resume

Not started.
