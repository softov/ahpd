---
title: An agent record turns off
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/agents/channel.ts#L474-L563](../../../../packages/sdk/src/agents/channel.ts#L474-L563) - `sync`, which skips a disabled record and keeps its sessions"
  - "[code://packages/sdk/src/agents/channel.ts#L299-L306](../../../../packages/sdk/src/agents/channel.ts#L299-L306) - `stateOf`, which answers `disabled` first"
  - "[code://packages/sdk/src/agents/channel.ts#L815-L824](../../../../packages/sdk/src/agents/channel.ts#L815-L824) - `put`, which carries `enabled` over"
  - "[code://packages/sdk/src/agents/channel.ts#L944-L983](../../../../packages/sdk/src/agents/channel.ts#L944-L983) - `check` and the methods map"
  - "[code://packages/sdk/src/tunnels/channel.ts#L524-L541](../../../../packages/sdk/src/tunnels/channel.ts#L524-L541) - the tunnel toggle this copies"
---

## Objective

`x-ahpd/agents/disable` writes `enabled: false` on an agent record, and `x-ahpd/agents/enable` writes `enabled: true`.
A disabled record is not opened, shows the state `disabled` and no alerts, and the sessions on it are not ended.
The channel answers which ids are disabled, for the host.

## Files

- `UPDATE: packages/sdk/src/types/agents.ts:176` - `AgentState` adds `disabled`.
- `UPDATE: packages/sdk/src/agents/channel.ts:84-90` - add the method names `ENABLE` and `DISABLE`.
- `UPDATE: packages/sdk/src/agents/channel.ts:299-306` - `stateOf` answers `disabled` for a record with `enabled: false`, before any other state.
- `UPDATE: packages/sdk/src/agents/channel.ts:474-563` - `sync` skips a disabled record, drops its alerts and views, and leaves it out of the ids whose sessions end.
- `UPDATE: packages/sdk/src/agents/channel.ts:815-824` - `put` keeps the stored `enabled`, and refuses an `enabled` in its params.
- `UPDATE: packages/sdk/src/agents/channel.ts:944-983` - add `enable` and `disable` with the grant `agent:put` and the owner's rule, as `check` has them; each writes the record, runs `take(await sync())`, and answers the row.
- `UPDATE: packages/sdk/src/agents/channel.ts:985-1010` - the channel answers `disabled(): ReadonlySet<string>`.
- `UPDATE: packages/sdk/test/agents-channel.test.ts` - the cases in *Validation*.
- `UPDATE: docs/plugins/PLUGINS.md:1915-1987` - the two methods, the field and the state `disabled`.
- `UPDATE: docs/updates/v0_15.md` - under *Unreleased*, *Plugins*: an agent record turns off and on.

## Steps

1. Add `disabled` to `AgentState`.
2. Add the two method names beside `PUT`, `REMOVE` and `CHECK`.
3. Make `stateOf` answer `disabled` for `enabled === false`.
4. In `sync`, skip a disabled record before you read its engine, and remove it from `open`.
5. Drop the views and the alerts of a disabled record.
6. In `sync`, end no sessions for the id of a disabled record.
7. Carry `enabled` from the stored record in `put`.
8. Write `enable` and `disable`, each authorized as `check` is.
9. Write the record, run `take(await sync())` in the channel's turn, refresh, and answer the row.
10. Answer `disabled()` from the stored records.
11. Update the docs and the release notes.
12. Write the tests.

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

2026-11-11. `AgentState` has `disabled`, and `AgentRecord` documents its optional `enabled`. The channel names `ENABLE` and `DISABLE` beside `PUT`, `REMOVE` and `CHECK`, and `stateOf` answers `disabled` for `enabled: false` before any other state.

`sync` skips a disabled record before it reads the engine, drops its `open` entry, its views, its alerts and its open failures, and leaves its id out of the `endSessionsOf` loop, so a toggle keeps the sessions it has. `put` refuses an `enabled` parameter and carries the stored `enabled` into the record. `enable` and `disable` take `agent:put` and the owner's rule, write the record, run `take(await sync())`, refresh and answer the row. `check` refuses a disabled record, which shows no alerts. The channel answers `disabled()` from the last read of the collection.

The tests cover the row and the fold, the kept sessions, a stored disabled record with a missing `fromEnv` variable, enabling again, a put on a disabled record, and the two refusals. `PLUGINS.md` lists the state, the field and the two methods, and the release notes say a record turns off and on.

`packages/sdk/test/agents-channel.test.ts` passed 50 tests. The full `packages/sdk` suite passed 4712 tests, with 5 skipped and 2 failed in `host-permissions.test.ts`, which need a tmpdir outside the home. The harness denied every command with a `TMPDIR=` prefix, so the suite ran without it. The wire fixture did not change. `pnpm exec tsc -p tsconfig.json --noEmit` passed.
