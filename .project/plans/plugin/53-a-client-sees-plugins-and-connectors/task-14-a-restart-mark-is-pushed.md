---
title: The restart mark is pushed to every client
status: done
depends: [task-11-a-plugin-command-marks-a-restart.md]
layer: "sdk, docs"
refs:
  - "[code://packages/sdk/src/host/actions.ts#L418](../../../../packages/sdk/src/host/actions.ts#L418) - a root configuration write sets `restartNeeded`"
  - "[code://packages/sdk/src/host.ts#L1337](../../../../packages/sdk/src/host.ts#L1337) - `markRestartNeeded`, which a plugin command calls"
  - "[code://packages/sdk/src/host.ts#L520-L532](../../../../packages/sdk/src/host.ts#L520-L532) - `broadcast`, one message to everyone watching a channel"
  - "[code://packages/sdk/src/host/root.ts#L625](../../../../packages/sdk/src/host/root.ts#L625) - where the root state carries `ahpd.restartNeeded`"
---

## Objective

A client that already watches the root learns of `ahpd.restartNeeded` when the mark is set.
It does not have to read the root state again.
A root configuration write and a plugin command send the same notification.

## Files

- `UPDATE: packages/sdk/src/host/context.ts` - one call that sets `restartNeeded` and sends the notification.
- `UPDATE: packages/sdk/src/host.ts` - build that call, and make `markRestartNeeded` use it.
- `UPDATE: packages/sdk/src/host/actions.ts:418` - the root configuration write uses the same call.
- `UPDATE: packages/sdk/test/plugin-host.test.ts` - the cases below.
- `UPDATE: docs/sdk/HOST.md` - the notification, beside `ahpd.restartNeeded`.
- `UPDATE: docs/plugins/PLUGINS.md` - the plugin commands send it.
- `UPDATE: CHANGELOG.md` - the notification under `0.14.0 - unreleased`.

## Steps

1. Add one host call that sets `restartNeeded` and sends `x-ahpd/restartNeeded`.
2. Send the notification with `broadcast` on `ahp-root://`, with params `{ channel: "ahp-root://" }`.
3. Send it only when `restartNeeded` changes from false to true.
4. Make `markRestartNeeded` and the root configuration write use that call.
5. In `PLUGINS.md`, say that the plugin commands send the notification.
6. Document the notification in `HOST.md` and in the changelog.
7. Run the SDK and server tests and `pnpm -s docs:build`.
8. Set this task and the plan row to `implemented`.

## Validation

- `plugin-host.test.ts`: a client that watches the root gets `x-ahpd/restartNeeded` after `markRestartNeeded`.
- `plugin-host.test.ts`: a root configuration write that needs a restart sends the same notification.
- `plugin-host.test.ts`: a second mark sends nothing, and a client that does not watch the root gets nothing.
- `pnpm -s build`, `pnpm -s typecheck`, `pnpm -s boundary` and `pnpm -s docs:build` pass.

## Resume

- **Done so far:** `HostContext` has one call, `markRestart`, and the notification is sent from it.
  It sets `restartNeeded` and sends `x-ahpd/restartNeeded` with `{ channel: "ahp-root://" }` to every connection watching the root.
  A second call returns without either.
  `markRestartNeeded` and the root configuration write in `actions.ts` both call it.
  `PLUGINS.md` says the plugin commands send the notification, and `HOST.md` and the changelog describe it.
  `plugin-host.test.ts` has the three cases.
  A root watcher is told after `markRestartNeeded`, and a root configuration write that answers `restartNeeded` sends the same notification.
  A second mark sends nothing, and a client not watching the root gets nothing.
- **Next action:** the final verification checklist in `plan.md`.
- **Open questions:** none.
- **Departures:** `packages/sdk/src/types/host.ts` is not in the Files list, but its `markRestartNeeded` doc said nothing is pushed, so it now says the notification is sent.
  The test helpers `listening`, `toldOfRestart` and `settle` were added to `plugin-host.test.ts` beside the cases, because that file's `peer()` keeps no notifications.
- **Watch out for:** no protocol action carries `_meta`, so the notification is an `x-ahpd` extension.
  A client that does not know it ignores it and reads the root state as before.
