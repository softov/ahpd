---
title: devtunnel is a kind on the SDK
status: implemented
depends:
  - task-01-a-plugin-registers-a-tunnel-kind.md
  - task-03-the-daemon-keeps-the-tunnels.md
layer: tunnel-devtunnel
refs:
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L97-L235](../../../../packages/tunnel-devtunnel/src/plugin.ts#L97-L235) - the tunnel made at `listening`, the hop, the `say` lines, the poll and the stop"
  - "[code://packages/tunnel-devtunnel/src/devtunnel.ts#L124-L228](../../../../packages/tunnel-devtunnel/src/devtunnel.ts#L124-L228) - `find`, `show`, `create`, `prepare` and `remove`: each CLI call the SDK replaces"
  - "[code://packages/tunnel-devtunnel/src/discovery.ts#L24-L69](../../../../packages/tunnel-devtunnel/src/discovery.ts#L24-L69) - the port, the labels and the derived token, which stay"
  - "[code://packages/tunnel-devtunnel/src/forward.ts#L37](../../../../packages/tunnel-devtunnel/src/forward.ts#L37) - the hop from `31546` to the daemon's port"
  - "[code://packages/tunnel-devtunnel/src/view.ts#L39-L69](../../../../packages/tunnel-devtunnel/src/view.ts#L39-L69) - the page, which keeps its shape"
  - "[code://packages/tunnel-devtunnel/package.json#L75-L82](../../../../packages/tunnel-devtunnel/package.json#L75-L82) - `contracts` and `optionsSchema`"
  - plans/plugin/20261102-1054-a-connector-signs-in-with-a-device-code/task-03-a-devtunnel-connector-signs-in.md - the `devtunnel` adapter and the token reader by connector id
  - https://github.com/microsoft/dev-tunnels/blob/b73b0eb774b/ts/src/connections/tunnelRelayTunnelHost.ts#L693-L737 - `refreshPorts` serves a port added after the host started
  - https://github.com/microsoft/dev-tunnels/tree/b73b0eb774b/ts/src/management - the management client: tunnels, ports, access and labels
---

## Objective

The devtunnel plugin registers a `devtunnel` kind and runs the Dev Tunnels SDK in the daemon, with no CLI.
Each tunnel is a port on the Dev Tunnel of its connector.
The system tunnel keeps its Dev Tunnel id, its labels and the port `31546`, so every client still finds it.

## Files

- `CREATE: packages/tunnel-devtunnel/src/service.ts` - the SDK: one management client and one tunnel host for each connector, and the ports on it.
- `DELETE: packages/tunnel-devtunnel/src/devtunnel.ts` - the CLI calls, which the SDK replaces.
- `CREATE: packages/tunnel-devtunnel/src/kind.ts` - the `devtunnel` kind: schema, operations, handlers and `system`.
- `UPDATE: packages/tunnel-devtunnel/src/plugin.ts:97-235` - register the kind, read `connector`, and keep the `say` lines and the page for the system tunnel.
- `UPDATE: packages/tunnel-devtunnel/src/view.ts:39-69` - read the state from the SDK instead of `devtunnel show`.
- `UPDATE: packages/tunnel-devtunnel/package.json:75-82` - the SDK dependencies, `contracts.tunnelKinds: ["devtunnel"]`, and `connector` in `optionsSchema`.
- `UPDATE: packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts` - the kind against a fake service.
- `CREATE: packages/tunnel-devtunnel/test/tunnel-devtunnel-kind.test.ts` - the schema, the operations and `system`.
- `UPDATE: docs/plugins/tunnel-devtunnel.md` - sign in first, the `connector` option, the kind, and the CLI no longer needed.

## Steps

1. Add `@microsoft/dev-tunnels-connections`, `-management`, `-contracts`, `-ssh` and `-ssh-tcp` at `^1.3.61` and `^3.12.42`.
2. Read the connector's token with the reader of plan 20261102-1054 task 03, as `github <token>`.
3. Find the connector's Dev Tunnel by the `_ahpd` label, or create one with `LABELS` and the name label.
4. Host each connector's Dev Tunnel once, with the SDK's relay host, and share it among that connector's tunnels.
5. On `start`, add the record's port with its anonymous access, and call `refreshPorts`.
6. On `stop`, remove the port and call `refreshPorts`. Close the host when its last port goes.
7. Delete the Dev Tunnel on the last `stop` only when `keep` is false.
8. Report the port's URL, `https://<id>-<port>.<region>.devtunnels.ms/`, from the SDK's answer.
9. Give the kind the schema `connector`, marked `x-ahpd-connector: devtunnel`, `port`, and `anonymous`, false by default.
10. List the operations `start`, `stop`, `restart` and `anonymous`, with `anonymous` taking `{ on }`.
11. On `restart`, connect the relay host again. On `anonymous`, set the port's access, and save `anonymous` in the record.
12. Give the kind an `update` that changes the access live, and restarts the port when `port` changes.
13. When the option `connector` has a value, answer `system` with `{ connector, port: 31546, anonymous }`.
14. Without `connector`, answer nothing, and alert that a person signs in and sets the option.
15. For the system tunnel, run the existing hop from `31546` to the daemon's port when the two differ.
16. Keep the `say` lines of the system tunnel: its id, its port, and the derived token on a guarded daemon.
17. Keep the page and its poll for the system tunnel, read through the management client.
18. Report `error` when the connector is not open, with "sign in to this connector again".
19. Remove every CLI call, spawn and seam, and keep `Seams` only for the fake service.
20. Write the doc: sign in first, set `connector`, the kind, the operations, and the risk of a new id.

## Validation

- `packages/tunnel-devtunnel/test/tunnel-devtunnel-kind.test.ts` holds the schema with its connector mark, the four operations, and `system` with and without `connector`.
- `packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts` holds: two tunnels of one connector share one host, and the second port calls `refreshPorts`.
- The same file holds: devtunnel reuses a Dev Tunnel with the `_ahpd` label, so its id stays.
- The same file holds: the last `stop` closes the host, and deletes the Dev Tunnel only with `keep` false.
- The same file holds: a connector that is not open reports `error`, and no log line carries a token.
- `rg -n "spawn\\(|'devtunnel'" packages/tunnel-devtunnel/src` finds no CLI call.
- `pnpm --filter @ahpd/tunnel-devtunnel test` passes.
- `pnpm typecheck` passes, and the Windows CI installs the SDK.
- By hand: after the upgrade, VS Code and ahpc reach the daemon with the token they had.
- By hand: `x-ahpd/invokeOperation` with `devtunnel/create` on a local port forwards it, and its URL answers.

## Resume

Built. The plugin registers the `devtunnel` connector and the `devtunnel` kind, and runs the Dev Tunnels SDK in the daemon. Nothing spawns a process.

- `src/service.ts` is the seam under the SDK: `Service`, `Cloud` and `Host`, with `sdkService`. One management client and one relay host for each connector. A port goes on with `createOrUpdateTunnelPort` and the host is refreshed after every port. The Dev Tunnel is found by the `_ahpd` label and reused, so its id stays. The last stop closes the host, and deletes the Dev Tunnel only with `keep` false.
- `src/kind.ts` is the kind: the schema with `connector` marked `x-ahpd-connector: devtunnel`, `port` and `anonymous`; the operations `start`, `stop`, `restart` and `anonymous`; `create`, `update`, `remove`, `invoke` and `system`; the hop from `31546`; the `say` lines; and the page's poll over `service.show`.
- `src/plugin.ts` registers the adapter, the kind, and a closer that closes every relay host. `src/devtunnel.ts` is deleted, and `src/index.ts` exports the kind and the service types.
- `package.json` carries the SDK dependencies, `contracts.adapters`, `contracts.tunnelKinds`, `contracts.closers`, and `connector` in `optionsSchema`.
- Tests: `test/tunnel-devtunnel-kind.test.ts` covers the schema, the operations and `system` with and without `connector`. `test/tunnel-devtunnel.test.ts` covers the kind against a fake `Cloud` and `Host`: two ports on one host with `refreshPorts`, reuse by label, the last stop with and without `keep`, a connector that is not open, anonymous access live, and a moved port. `test/tunnel-devtunnel-view.test.ts` covers the page and its poll against a scripted `Service`: the drawn view, a redraw only on change, a failed read that keeps the page and warns once, and a stop that clears it.
- The doc is the README, because `docs/plugins/tunnel-devtunnel.md` includes it: `connector` first, no CLI, the kind and its operations, and the new id that a deleted Dev Tunnel costs. `docs/plugins/PLUGINS.md` says a report may carry `settings`.

Departures from the steps:

1. Step 11's "save `anonymous` in the record" had no path in the SDK: `invoke` returns nothing and the plugin holds no grant. `TunnelReport` gained an optional `settings`, and `tunnelsChannel` saves those fields as a put does - a secret moves to the vault, the host's own fields are refused - and awaits the save before it answers the operation. The kind reports `{ settings: { anonymous: on } }`, and `packages/sdk/test/tunnels-channel.test.ts` covers the save.
2. `src/view.ts` is unchanged. The state it draws now comes from `service.show` through the kind; `tunnelView` and `sameState` only shape a state that was already read, so there was nothing in the file itself to replace.
3. `docs/plugins/tunnel-devtunnel.md` was not edited: it is an include of the README, so the doc text is there.
4. The anonymous access entry needed `subjects: []`. The SDK's type requires it, and the service ignores it for the anonymous type.
5. `contracts.closers` was added to the manifest, because the plugin now closes relay hosts. `packages/server/test/plugin-contracts.test.ts` and `packages/server/test/plugin-load.test.ts` list the plugin's contracts and options, so both were updated.

The check `rg -n "spawn\(|'devtunnel'" packages/tunnel-devtunnel/src` answers only `adapter.ts` and `kind.ts` at their registration names. Neither is a CLI call.

Checks by hand, still pending review:

- After the upgrade, VS Code and ahpc reach the daemon with the token they had.
- `x-ahpd/invokeOperation` with `devtunnel/create` on a local port forwards it, and its URL answers.
