---
title: The host keeps the tunnels - implemented
date: 2026-11-02
refs:
  - git://01e7ca37 - the merge of ahpd #189
  - "[code://packages/sdk/src/types/tunnels.ts](../../../../packages/sdk/src/types/tunnels.ts) - `TunnelKind`, `Tunnel` and `TunnelReport`"
  - "[code://packages/sdk/src/kinds/operations.ts#L121-L150](../../../../packages/sdk/src/kinds/operations.ts#L121-L150) - `x-ahpd/invokeOperation`"
  - "[code://packages/sdk/src/tunnels/channel.ts#L117](../../../../packages/sdk/src/tunnels/channel.ts#L117) - `tunnelsChannel`"
  - "[code://packages/tunnel-devtunnel/src/kind.ts](../../../../packages/tunnel-devtunnel/src/kind.ts) - the `devtunnel` kind"
---

The host keeps a list of tunnels at `x-ahpd-tunnels://`, and any plugin can add a kind of tunnel.
The list's state carries its operations, and a client runs one with `x-ahpd/invokeOperation`.
devtunnel is the first kind. It runs the Dev Tunnels SDK in the daemon, and each tunnel names a `devtunnel` connector.
The system tunnel that VS Code and ahpc find is now a record of the list, on the port `31546` as before.
No `devtunnel` process runs.

## What was built

- [`code://packages/sdk/src/types/kinds.ts`](../../../../packages/sdk/src/types/kinds.ts) - `KindOperation`, `Operation`, `OperationScope` and `OperationStatus`.
- [`code://packages/sdk/src/types/tunnels.ts`](../../../../packages/sdk/src/types/tunnels.ts) - the tunnel kind, the record, the report and the purpose.
- [`code://packages/sdk/src/plugins/validate.ts`](../../../../packages/sdk/src/plugins/validate.ts) - `checkTunnelKind`, and `registerTunnelKind` against `contracts.tunnelKinds`.
- [`code://packages/sdk/src/kinds/operations.ts`](../../../../packages/sdk/src/kinds/operations.ts) - `invokeOperation`, which serves `x-ahpd/invokeOperation` for every channel with operations.
- [`code://packages/sdk/src/tunnels/channel.ts`](../../../../packages/sdk/src/tunnels/channel.ts) - the tunnels records channel, its four host operations, the vault for secrets, and `startAll`, `stopAll` and `urls`.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - the `tunnels` collection, the start after `listening`, the stop before `stopping`, and the `Host` checks.
- [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts) - the `tunnelHosts` setting, off by default.
- [`code://packages/tunnel-devtunnel/src/service.ts`](../../../../packages/tunnel-devtunnel/src/service.ts) - one management client and one relay host for each connector, with the Dev Tunnel found by its `_ahpd` label.
- [`code://packages/tunnel-devtunnel/src/kind.ts`](../../../../packages/tunnel-devtunnel/src/kind.ts) - the `devtunnel` kind, its operations, its system tunnel and the hop from `31546`.
- [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) - "A tunnel kind of your own" and the `tunnelKinds` contract.
- The branch `host/20261102-1347-grants-follow-the-answers`, from Softov's answer on 2026-11-02: `handle` checks `operation.grant`, so `operation:invoke` alone runs no operation.

## Verified

- `plugin-validate.test.ts` 35 cases, `plugin-fold.test.ts` 34, `kinds-operations.test.ts` 7, `tunnels-channel.test.ts` 7 and more for the report's `settings`.
- `packages/server/test/tunnels.test.ts` runs a real daemon with a fake kind plugin, 5 cases. The SIGTERM case is skipped on Windows, because SIGTERM is a kill there.
- `tunnel-devtunnel-kind.test.ts`, `tunnel-devtunnel.test.ts` and `tunnel-devtunnel-view.test.ts` cover the kind against a fake Dev Tunnels service.
- ahpd #189 passed its 11 CI checks, Windows included, after MayCXC's union was merged in.
- A real Dev Tunnel and a client that connected before the upgrade are not verified. They are in [plugin-1122-tunnel-checks.md](../../../pending/plugin-1122-tunnel-checks.md).

## Departures from the plan

- `TunnelReport` has an optional `settings`, and the channel saves those fields as a put does. The `anonymous` operation had no other path to save its value.
- A new tunnel's id is `<kind>-<8 hex>`, made by the host.
- A list operation's status change sends the whole operations array, not a diff.
- A record whose kind no plugin holds stays `stopped`, so a plugin that is off keeps its tunnels on the list.
- A stdio host starts no tunnel, because it has no address to forward to.
- With `tunnelHosts` on, the API's `Origin` check takes each URL's origin too.
- Each task's *Resume* lists its own departures, such as the files the Files lists did not name.

## Left for later

- Whether a `devtunnel` connector can take its token from `fromEnv`, and which long-lived token the Dev Tunnels service accepts. Softov, 2026-11-02: find the token first, in a brief; decide `fromEnv` after it. Until then the device sign-in is the only way.
- The view's data, the ahpw forms, the canvas URL and the limits by purpose, as *Goal* says.
- The first commit on the branch, `e4c9c5ef`, does not typecheck alone. The branch builds from `694687f7`.
