---
title: A refused action is not applied
status: done
depends: []
layer: "sdk tests"
refs:
  - "[code://packages/sdk/test/conformance.test.ts#L144-L207](../../../../packages/sdk/test/conformance.test.ts#L144-L207) - `dispatch` and `held`"
  - "[code://packages/sdk/test/conformance.test.ts#L888-L926](../../../../packages/sdk/test/conformance.test.ts#L888-L926) - a config change under a key no schema declares"
  - "[code://packages/sdk/test/notes.test.ts#L81-L105](../../../../packages/sdk/test/notes.test.ts#L81-L105) - `actions` and `reduced`"
  - "[code://packages/sdk/test/operations.test.ts#L113-L117](../../../../packages/sdk/test/operations.test.ts#L113-L117) - `actions`"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/reconciliation.md#L29-L30 - a rejected action is removed, never applied"
---

## Objective

A fold that stands for a client leaves a refused envelope out.
The conformance suite sends only what the protocol declares.

## Files

- `UPDATE: packages/sdk/test/conformance.test.ts:144-207` - `dispatch` numbers each action, and `held` leaves a refused envelope out.
- `UPDATE: packages/sdk/test/conformance.test.ts:220-960` - each `chat/turnStarted` carries `startedAt` and a message `origin`.
- `UPDATE: packages/sdk/test/conformance.test.ts:888-926` - the config case changes `permissionMode`, the key the schema declares.
- `UPDATE: packages/sdk/test/notes.test.ts:81-105` - `actions` leaves a refused envelope out, and `say` sends a declared turn.
- `UPDATE: packages/sdk/test/operations.test.ts:113-117` - `actions` leaves a refused envelope out.

## Steps

1. Number every dispatch in the conformance suite with a `clientSeq`.
2. Give every `chat/turnStarted` there a `startedAt` and a message `origin`.
3. Change the config case to `permissionMode`, both its accepted value and its refused one.
4. Leave refused envelopes out of `held`, and out of the notes and operations folds.

## Validation

- `pnpm exec vitest run packages/sdk/test/conformance.test.ts packages/sdk/test/notes.test.ts packages/sdk/test/operations.test.ts` passes.

## Resume

Done 2026-11-01 in a2d286cb. The notes and operations suites' own dispatches still send no `clientSeq`; see [deferred.md](deferred.md).
