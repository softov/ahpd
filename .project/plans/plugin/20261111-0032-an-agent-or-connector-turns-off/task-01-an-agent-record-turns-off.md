---
title: An agent record turns off
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/agents/channel.ts#L474-L563](../../../../packages/sdk/src/agents/channel.ts#L474-L563) - `sync`, which skips a disabled record, keeps a paused one open and keeps the sessions of both"
  - "[code://packages/sdk/src/agents/channel.ts#L299-L306](../../../../packages/sdk/src/agents/channel.ts#L299-L306) - `stateOf`, which answers `disabled` and then `paused`"
  - "[code://packages/sdk/src/agents/channel.ts#L815-L824](../../../../packages/sdk/src/agents/channel.ts#L815-L824) - `put`, which carries the stored mode over"
  - "[code://packages/sdk/src/agents/channel.ts#L944-L983](../../../../packages/sdk/src/agents/channel.ts#L944-L983) - `check` and the methods map"
  - "[code://packages/sdk/src/tunnels/channel.ts#L524-L541](../../../../packages/sdk/src/tunnels/channel.ts#L524-L541) - the tunnel toggle this copies"
---

## Objective

An agent record carries `mode`: `enabled`, `paused` or `disabled`. A record with no `mode` is enabled, and a record written before the field that holds `enabled: false` reads as disabled.
`x-ahpd/agents/disable` writes `mode: disabled`, `x-ahpd/agents/pause` writes `mode: paused`, and `x-ahpd/agents/enable` writes `mode: enabled`.
A disabled record is not opened, shows the state `disabled` and no alerts, and the sessions on it are not ended.
A paused record is opened and shows the state `paused` with its alerts, and the sessions on it are not ended.
The channel answers which ids are paused and which are disabled, for the host.

## Files

- `UPDATE: packages/sdk/src/types/agents.ts:176` - `AgentState` adds `paused` and `disabled`, and `AgentMode` names the three.
- `UPDATE: packages/sdk/src/types/agents.ts:70` - `AgentRecord` carries `mode`, and keeps `enabled` as the older field.
- `UPDATE: packages/sdk/src/agents/channel.ts:84-90` - add the method names `ENABLE`, `PAUSE` and `DISABLE`.
- `UPDATE: packages/sdk/src/agents/channel.ts:299-306` - `modeOf` reads `mode`, else `enabled`, and `stateOf` answers `disabled` and then `paused` before any other state.
- `UPDATE: packages/sdk/src/agents/channel.ts:474-563` - `sync` skips a disabled record, opens a paused one as it opens an enabled one, and ends the sessions of neither.
- `UPDATE: packages/sdk/src/agents/channel.ts:815-824` - `put` keeps the stored `mode` or `enabled`, and refuses either in its params.
- `UPDATE: packages/sdk/src/agents/channel.ts:944-983` - add `enable`, `pause` and `disable` with the grant `agent:put` and the owner's rule, as `check` has them; each writes the record, runs `take(await sync())`, and answers the row.
- `UPDATE: packages/sdk/src/agents/channel.ts:985-1010` - the channel answers `disabled(): ReadonlySet<string>` and `paused(): ReadonlySet<string>`.
- `UPDATE: packages/sdk/test/agents-channel.test.ts` - the cases in *Validation*.
- `UPDATE: docs/plugins/PLUGINS.md:1915-1987` - the three methods, the field and the states `paused` and `disabled`.
- `UPDATE: docs/updates/v0_15.md` - under *Unreleased*, *Plugins*: an agent record has three states.

## Steps

1. Add `paused` and `disabled` to `AgentState`, and `AgentMode`.
2. Add the three method names beside `PUT`, `REMOVE` and `CHECK`.
3. Read a record's mode: `mode` when it names one, else `enabled: false` gives `disabled`, else `enabled`.
4. Make `stateOf` answer `disabled`, then `paused`, before it reads the engine.
5. In `sync`, skip a disabled record before you read its engine, and remove it from `open`.
6. Drop the views and the alerts of a disabled record; open and keep a paused one as you do an enabled one.
7. In `sync`, end no sessions for the id of a disabled or paused record.
8. Carry the stored `mode`, or the older `enabled`, in `put`, and refuse either parameter.
9. Write `enable`, `pause` and `disable`, each authorized as `check` is.
10. Write the record, drop the older `enabled` field, run `take(await sync())` in the channel's turn, refresh, and answer the row.
11. Answer `disabled()` and `paused()` from the stored records.
12. Update the docs and the release notes.
13. Write the tests.

## Validation

- A paused record opens, its row is `paused`, and its alerts show as usual.
- `x-ahpd/agents/pause` moves an enabled or disabled record to `paused`, and `enable` and `disable` move it out.
- A record that still holds `enabled: false` reads as `disabled`.
- `packages/sdk/test/agents-channel.test.ts`: `disable` makes the row `disabled`, and the agent leaves the list `refold` gets.
- `disable` on an agent with a running session does not call `endSessionsOf` for it.
- A disabled record with a missing `fromEnv` variable raises no alert and reads no variable.
- `enable` opens the record again, and its row is `ready`.
- A `put` on a disabled record keeps it disabled.
- The channel refuses a caller without `agent:put`, and a caller who is not the owner.
- `TMPDIR=/home/softov/tmp/ahpd-test npx vitest run packages/sdk` passes.

## Resume

2026-11-11. `AgentRecord` carries `mode?: AgentMode`, where `AgentMode` is `enabled`, `paused` or `disabled`, and keeps `enabled?: boolean` as the field older records hold. `AgentState` names six states, `paused` and `disabled` among them. The channel names `ENABLE`, `PAUSE` and `DISABLE` beside `PUT`, `REMOVE` and `CHECK`.

`modeOf` reads a stored record: a `mode` that names one of the three wins, else `enabled: false` gives `disabled`, else the record is `enabled`. `stateOf` answers `disabled` first, then `paused`, and only then reads the engine, so a paused record keeps its alerts whatever its open says.

`sync` skips a disabled record before it reads the engine, drops its `open` entry, its views, its alerts and its open failures, and leaves its id out of the `endSessionsOf` loop; a paused record is opened, filled and served as an enabled one is, and its id is left out of that loop too. `put` refuses a `mode` or an `enabled` parameter and carries the stored `mode`, or the older `enabled`, into the record. `enable`, `pause` and `disable` take `agent:put` and the owner's rule, write `mode`, drop the older `enabled` field, run `take(await sync())`, refresh and answer the row. `check` refuses a disabled record, which shows no alerts, and checks a paused one as it checks an enabled one. The channel answers `disabled()` and `paused()` from the last read of the collection.

The tests cover the row and the fold, a paused record that stays open with its alerts, the kept sessions of both states, a stored disabled record with a missing `fromEnv` variable, enabling again, a put on a disabled record, the three moves, and the two refusals. `PLUGINS.md` lists the six states, the field and the six methods, and the release notes say a record has three states.

`packages/sdk/test/agents-channel.test.ts` passed 53 tests. The full `packages/sdk` suite: 236 of 237 files passed, 4728 tests passed, 5 skipped, and the same 2 failed in `host-permissions.test.ts`, which are the edit-approval cases that need a tmpdir outside the home. The harness denied every `TMPDIR=`-prefixed command and every `npx`, so the suite ran as `pnpm exec vitest run packages/sdk --maxWorkers=6 --testTimeout=20000`. The wire fixture did not change. `pnpm exec tsc -p tsconfig.json --noEmit` passed.
