---
title: An alert says when, and a record says each gap
status: done
depends: []
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L788-L809](../../../../packages/sdk/src/types/plugin.ts#L788-L809) - `Alert`, which gets `at`"
  - "[code://packages/server/src/plugins.ts#L1925-L1980](../../../../packages/server/src/plugins.ts#L1925-L1980) - `addAlert` and `dropAlert`, which move to the sdk"
  - "[code://packages/sdk/src/channels/owners.ts#L386-L441](../../../../packages/sdk/src/channels/owners.ts#L386-L441) - `resolved`, which learns to report every gap"
---

## Objective

`Alert` carries an optional `at`, and the host sets it when an alert arrives.
One sdk list keeps alerts by `ref`, and plugin rows use it.
`resolved` reports every missing variable and secret of a record in one error, and each gap has a `ref`.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:788-809` - add `at?: string`, the ISO time the alert was raised, to `Alert`.
- `CREATE: packages/sdk/src/plugins/alerts.ts` - `alertList(limit)`: `add` replaces an alert with the same `ref` and stamps `at` when it has none, `drop(ref)`, `clear()` and `list()`.
- `UPDATE: packages/server/src/plugins.ts:1925-1980` - `addAlert` and `dropAlert` keep each plugin's alerts in an `alertList` with `MAX_ALERTS`.
- `UPDATE: packages/sdk/src/channels/owners.ts:386-441` - `resolved` walks every field and throws a `RecordGaps` error with every gap.
- `UPDATE: packages/sdk/src/index.ts` - export `alertList` and `RecordGaps`.
- `CREATE: packages/sdk/test/alerts.test.ts` - the list's replace, drop, time and limit.
- `UPDATE: packages/sdk/test/owners-nested-secrets.test.ts` - two gaps in one record give one error with both.
- `UPDATE: docs/plugins/PLUGINS.md` - the alert section says `at`, and that the host sets it.

## Steps

1. Add `at` to `Alert`, with a comment that the host sets it when the plugin did not.
2. Write `alertList` from the logic of `addAlert` and `dropAlert`, with the newest alert at the end.
3. Make `plugins.ts` keep each plugin's list in an `alertList`, and keep `alertsChanged` as it is.
4. Define `RecordGaps`, an `Error` with `gaps: { ref: string; text: string }[]`.
5. Make `resolved` collect a gap for each missing variable as `env:<VARIABLE>`, and for each missing secret as `secret:<name>`.
6. Throw `RecordGaps` once the walk ends, with `message` set to the first gap's text.
7. Keep the owner refusal for `fromEnv` a plain error, thrown at once, as today.
8. Write the tests.

## Validation

- `packages/sdk/test/alerts.test.ts`: a second alert with the same `ref` replaces the first, at the end.
- `packages/sdk/test/alerts.test.ts`: `drop` removes an alert, and an alert with no `at` gets one.
- `packages/sdk/test/alerts.test.ts`: past the limit, the oldest alert goes.
- `packages/sdk/test/owners-nested-secrets.test.ts`: two missing variables and one missing secret throw `RecordGaps` with three gaps.
- `packages/sdk/test/owners-nested-secrets.test.ts`: the error's `message` is the first gap's text.
- The existing plugin alert tests in `packages/server/test` pass with no change.
- `pnpm typecheck` passes.

## Resume

2026-11-10. `Alert.at` is added, and `alertList(limit)` in `packages/sdk/src/plugins/alerts.ts` holds one list's alerts by `ref`. The plugins channel keeps each plugin's list in one, and `alerts()` answers a copy of it. The plugins channel still maps an alert to `level`, `text` and `ref` on the row; `at` is held by the list and not served there. Three server tests that read `alerts()` directly compare the whole alert, so they now expect `at` as `expect.any(String)`; the row tests pass unchanged.

`RecordGaps` carries every gap of a record. `resolved` now walks a nested array in order rather than with `Promise.all`. The gaps come out in config order, and the message is the first gap's text. A `fromEnv` on a record that is not the host's, and a vault that throws, are still thrown at once as a plain error.

The harness denied every command with a `TMPDIR=` prefix, so the tests ran without it: `pnpm exec vitest run packages/sdk/test/alerts.test.ts` passed 5, `packages/sdk/test/owners-nested-secrets.test.ts` passed 11, and `packages/server/test/plugins-channel.test.ts` passed 49. `pnpm exec tsc -p tsconfig.json --noEmit` passed.
