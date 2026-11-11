---
title: An agent row lists its alerts
status: done
depends: [task-01-an-alert-says-when-and-each-gap.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/agents.ts#L175-L186](../../../../packages/sdk/src/types/agents.ts#L175-L186) - `AgentState` gets `failed`, and `AgentHealth` goes"
  - "[code://packages/sdk/src/agents/channel.ts#L299-L306](../../../../packages/sdk/src/agents/channel.ts#L299-L306) - `stateOf`"
  - "[code://packages/sdk/src/agents/channel.ts#L326-L338](../../../../packages/sdk/src/agents/channel.ts#L326-L338) - `row`"
  - "[code://packages/sdk/src/agents/channel.ts#L526-L542](../../../../packages/sdk/src/agents/channel.ts#L526-L542) - the failed open in `sync`"
  - "[code://packages/sdk/src/agents/channel.ts#L944-L980](../../../../packages/sdk/src/agents/channel.ts#L944-L980) - `check`"
---

## Objective

An agent row carries `alerts` and no `health`.
A failed open raises one alert per gap, or one `open` alert, and the row's state is `failed`.
A probe that is not `ok` raises a `probe` alert beside them, and an `ok` probe clears it.

## Files

- `UPDATE: packages/sdk/src/types/agents.ts:175-186` - `AgentState` adds `failed`; remove `AgentHealth`.
- `UPDATE: packages/sdk/src/agents/channel.ts:245-248` - replace `healths` with one `alertList` per record id.
- `UPDATE: packages/sdk/src/agents/channel.ts:299-306` - `stateOf` answers `failed` for an id in `openFailures`, and `invalid` only for a config that does not fit or a record the host refused.
- `UPDATE: packages/sdk/src/agents/channel.ts:326-338` - `row` serves `alerts` when the list is not empty.
- `UPDATE: packages/sdk/src/agents/channel.ts:526-542` - a failed open raises an alert per gap of `RecordGaps`, or one `open` alert; a good open clears `open` and every `env:` and `secret:` alert.
- `UPDATE: packages/sdk/src/agents/channel.ts:944-980` - `check` raises or clears `probe`, and a failed rebuild raises the open alerts.
- `UPDATE: packages/sdk/src/agents/channel.ts:900-906` - a removed record drops its list.
- `UPDATE: packages/sdk/src/index.ts` - stop exporting `AgentHealth`.
- `UPDATE: packages/sdk/test/agents-channel.test.ts` - the cases in *Validation*.
- `UPDATE: docs/plugins/PLUGINS.md:1915-1987` - the agent row's `alerts`, the refs, and the state `failed`.
- `UPDATE: docs/updates/v0_15.md` - under *Unreleased*: *Upgrading* says `health` is now `alerts`; *Plugins* says what a row lists.

## Steps

1. Add `failed` to `AgentState`, and remove `AgentHealth` and its export.
2. Keep an `alertList` per record id in place of `healths`.
3. In `sync`, raise one `error` alert per gap of a `RecordGaps` error, and one `open` alert for any other error.
4. In `sync`, clear `open` and the gap alerts when a record opens.
5. Make `stateOf` answer `failed` for an id in `openFailures`.
6. In `check`, raise `probe` with level `warning` for `unreachable` or `failed`, and clear it on `ok`.
7. In `check`, raise the open alerts when the rebuild throws, as `sync` does.
8. Drop the list of a removed record.
9. Serve `alerts` on the row, and no `health` key.
10. Update the docs and the release notes.
11. Write the tests.

## Validation

- `packages/sdk/test/agents-channel.test.ts`: a host record with two `fromEnv` variables unset is `failed` with two `env:` alerts.
- The same record with the variables set opens, and its row has no alerts.
- A probe that throws raises `probe`, and an `ok` probe clears it.
- A record whose config does not fit its engine is `invalid`, with no alert.
- No row has a `health` key.
- `TMPDIR=/home/softov/tmp/ahpd-test npx vitest run packages/sdk` passes.

## Resume

2026-11-10. `AgentState` has `failed`, and `AgentHealth` is removed from the types and from `packages/sdk/src/types/index.ts`. Each agent id keeps an `alertList` in place of `healths`, and the row serves `alerts` when the list is not empty.

A failed open raises one `error` alert for each gap of a `RecordGaps` error, or one `open` alert for any other error, and puts the id in `openFailures`, which makes `stateOf` answer `failed`. An open that works clears `open` and every `env:` and `secret:` alert. A check raises `probe` at level `warning` when the probe is `unreachable` or throws, clears it on `ok`, and raises the open alerts when the rebuild throws. A removed record drops its list.

The docs say what each `ref` means, and the release notes say `health` is now `alerts` and what an agent row lists. The harness denied every command with a `TMPDIR=` prefix, so the suite ran without it: `packages/sdk` passed 4702 tests and 2 failed in `host-permissions.test.ts`, which need a tmpdir outside the home. The four wire cases failed until `pnpm -s schema` made `tools/ahp.strict.schema.json`. `pnpm exec tsc -p tsconfig.json --noEmit` passed.
