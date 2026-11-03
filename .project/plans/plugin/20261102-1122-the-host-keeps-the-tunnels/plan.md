---
title: The host keeps the tunnels
domain: plugin
status: built
priority: high
created: 2026-11-02
revalidated: 2026-11-02
requires:
  - plans/plugin/20261102-1054-a-connector-signs-in-with-a-device-code/plan.md
refs:
  - git://6213729e - the commit of ahpd this plan was checked at
  - briefs/the-host-keeps-the-tunnels.md - the brief this plan covers in part; the view's data, the ahpw forms and the canvas URL are later plans
  - "[code://packages/sdk/src/types/plugin.ts#L1444-L1454](../../../../packages/sdk/src/types/plugin.ts#L1444-L1454) - `registerAdapter` and `registerEngine`, which `registerTunnelKind` sits beside"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1777-L1786](../../../../packages/sdk/src/plugins/plugins.ts#L1777-L1786) - `registerAdapter` checks the name against `contracts` and keeps the adapter"
  - "[code://packages/sdk/src/plugins/plugins.ts#L479-L487](../../../../packages/sdk/src/plugins/plugins.ts#L479-L487) - the fold refuses an adapter name another plugin took, the rule a kind copies"
  - "[code://packages/sdk/src/plugins/validate.ts#L718](../../../../packages/sdk/src/plugins/validate.ts#L718) - `checkAdapter`, which `checkTunnelKind` copies"
  - "[code://packages/sdk/src/connectors/channel.ts#L264](../../../../packages/sdk/src/connectors/channel.ts#L264) - `connectorsChannel`: a records channel over a collection, with kinds, a vault and a schema check; the shape `tunnelsChannel` copies"
  - "[code://packages/sdk/src/connectors/channel.ts#L623-L695](../../../../packages/sdk/src/connectors/channel.ts#L623-L695) - `prepare`: a secret moves to the vault, and a blank secret keeps the stored one"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L1-L60](../../../../packages/sdk/src/resources/recordschannel.ts#L1-L60) - `recordsChannel`: the snapshot, `added`, `changed`, `removed` and `?owner=me`"
  - "[code://packages/computer/src/catalogue.ts#L27-L54](../../../../packages/computer/src/catalogue.ts#L27-L54) - a records channel with `ownerOf`, the second user of the shared core later"
  - "[code://packages/sdk/src/host/resourcemethods.ts#L287-L310](../../../../packages/sdk/src/host/resourcemethods.ts#L287-L310) - `invokeChangesetOperation`: an offered id, a target of the right scope; the checks `x-ahpd/invokeOperation` copies"
  - "[code://packages/sdk/src/types/plugin.ts#L522-L545](../../../../packages/sdk/src/types/plugin.ts#L522-L545) - `PluginMethod`: a grant, and `authorize` for a caller the grant refuses"
  - "[code://packages/server/src/commands/run.ts#L805](../../../../packages/server/src/commands/run.ts#L805) - the connectors collection, which the tunnels collection sits beside"
  - "[code://packages/server/src/commands/run.ts#L836](../../../../packages/server/src/commands/run.ts#L836) - `connectorsChannel` wired, which `tunnelsChannel` sits beside"
  - "[code://packages/server/src/commands/run.ts#L962-L963](../../../../packages/server/src/commands/run.ts#L962-L963) - the channels and methods the host serves"
  - "[code://packages/server/src/commands/run.ts#L1850-L1856](../../../../packages/server/src/commands/run.ts#L1850-L1856) - `listening` raised, after which the host starts the tunnels"
  - "[code://packages/server/src/commands/run.ts#L1667](../../../../packages/server/src/commands/run.ts#L1667) - the routes' `Host` check, from the announced names"
  - "[code://packages/server/src/commands/run.ts#L580](../../../../packages/server/src/commands/run.ts#L580) - the API's `Host` and `Origin` check"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L97-L235](../../../../packages/tunnel-devtunnel/src/plugin.ts#L97-L235) - the one tunnel devtunnel makes at `listening`, through the CLI"
  - "[code://packages/tunnel-devtunnel/src/discovery.ts#L24-L69](../../../../packages/tunnel-devtunnel/src/discovery.ts#L24-L69) - the port and labels VS Code finds a host by, which stay"
  - npm://@microsoft/dev-tunnels-connections@^1.3.61 - the SDK's tunnel host, MIT, which needs `@microsoft/dev-tunnels-ssh` and `@microsoft/dev-tunnels-ssh-tcp` as peers
  - npm://@microsoft/dev-tunnels-management@^1.3.61 - the SDK's management client: tunnels, ports and access, MIT
  - https://github.com/microsoft/dev-tunnels/blob/b73b0eb774b/ts/src/connections/tunnelRelayTunnelHost.ts#L693-L737 - the SDK host serves a port added after it started
  - https://github.com/microsoft/agent-host-protocol/blob/ff7d6a1c7b4/types/channels-changeset/state.ts#L259-L298 - `ChangesetOperation`, the reference for an operation in a channel's state
---

## Goal

The host keeps a list of tunnels at `x-ahpd-tunnels://`, and any plugin adds a kind of tunnel.
The list's state carries the operations, and a client invokes one with `x-ahpd/invokeOperation`.
devtunnel is the first kind. It runs the Dev Tunnels SDK in the daemon, and each tunnel names a `devtunnel` connector.
The system tunnel that VS Code and ahpc find stays reachable at the same address, now as a record of the list.
The view's data, the ahpw forms, the canvas URL and the limits by purpose are later plans.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "x-devtunnel" packages/*/src` - no match. devtunnel serves no methods to replace.
- `rg -n "registerAdapter" packages/sdk/src` - the type, the call and the fold, each a pattern for the kind.
- `rg -n "fromEnv" packages/sdk/src/connectors` - a host connector's secret may name an environment variable.
- `git diff --stat origin/main...maycxc/union` - MayCXC's open work changes `host/` chat and session files only. No overlap.
- `npm view @microsoft/dev-tunnels-connections@1.3.61` - it pulls `websocket`, whose native helpers have JavaScript fallbacks.

### Runtime path

```
plugin apply -> registerTunnelKind(devtunnel) -> fold refuses a name another plugin took
daemon listening -> host asks each kind's system() -> adds the system tunnel when the list has none
                 -> host starts each enabled tunnel -> kind invoke('start') -> report({ status, url })
client -> x-ahpd/invokeOperation { channel: x-ahpd-tunnels://, operationId: devtunnel/create, input }
       -> host checks the operation, the input and the grant -> secrets to the vault -> record saved
       -> kind create(tunnel) -> report({ status: running, url }) -> every subscriber sees the row
routes and, with the setting, the API -> Host check reads the list's URLs
```

### Gaps

- No list of tunnels exists, and no plugin can read the address another plugin gave.
- No plugin can offer a kind of tunnel, and no channel carries operations with an input.
- devtunnel needs the `devtunnel` CLI, signed in by hand, and holds one port.

## Answers

| What | Source | Task |
| --- | --- | --- |
| This plan holds the shared core, the tunnel list and the devtunnel kind | Softov, 2026-11-02: "Core, tunnel list, devtunnel kind" | - |
| The host owns the list and its operations, and a plugin adds a kind of tunnel | Softov, 2026-11-02: "Host owns it, plugins by kind" | 01, 02 |
| A kind is registered as an adapter is: the manifest lists its name in `contracts.tunnelKinds`, and the code gives the rest | Softov, 2026-11-02: "Like adapters" | 01 |
| The operations are in the list's state, and one command, `x-ahpd/invokeOperation`, serves every channel with operations. `invokeChangesetOperation` is the reference | Softov, 2026-11-02: "One shared command", "ok... put it as reference.." | 02 |
| The operations fall into four groups: a change to the list, what runs now, whether it runs, and the kind's own | Softov, 2026-11-02: "write onto the brief" | 01, 02 |
| The host stores each record, with its kind, its settings and `enabled`, and starts the enabled ones | Softov, 2026-11-02: "The host stores them" | 02, 03 |
| The kind's `update` decides whether a change applies live or restarts the tunnel | Softov, 2026-11-02: "The kind decides" | 01, 04 |
| A call on one record shows on the record's `operation`. A call on the list keeps its status on the operation | Softov, 2026-11-02: "On the record" | 02 |
| `remove` needs `tunnel:delete` and every other operation `tunnel:put`. A kind may name another grant for an operation | Softov, 2026-11-02: "host by group, kind own may name one... like it if wanted could name <thing>:restart or <thing>:<action> if wanted otherwise will write <thing>:put" | 01, 02 |
| A record has an optional `owner`, with `?owner=me`. A tunnel leaves it empty, so it belongs to the host | Softov, 2026-11-02: "Optional owner" | 02 |
| Each tunnel records the plugin that opened it and its `purpose`. The host sets the purpose, and no person types it | Softov, 2026-11-02: "I was referring from why the tunnels was openned... like was a tunnel for the system access. a tunnels for the canvas.. that thing." | 02, 03 |
| The API's `Host` check reads the list only when a setting turns it on. It is off by default | Softov, 2026-11-02: "A setting, off by default" | 03 |
| The devtunnel kind runs the Dev Tunnels SDK in the daemon, and calls `refreshPorts` for a new port | Softov, 2026-11-02: "Use the SDK in-process" | 04 |
| The CLI path goes. A devtunnel plugin with no connector alerts and opens no tunnel | Softov, 2026-11-02: "Remove the CLI path" | 04 |
| The system tunnel's connector is the devtunnel option `connector` | Softov, 2026-11-02: "A plugin option" | 04 |
| The limits by purpose come with the canvas plan. This plan keeps one system tunnel for each kind as a fixed host rule | Softov, 2026-11-02: "With the canvas plan" | 03 |
| The shared core is in the SDK: the kind's operations and the invoke command in `kinds/`, the tunnels channel in `tunnels/`. The server wires them as it wires the connectors | (defaulted: computers reuse the core later, and the connectors channel is wired the same way) | 01, 02, 03 |
| The channel's state is a records channel's `{ records }`, with `operations` beside it | (defaulted: every records channel answers `{ records }`; the brief's example says `tunnels` only to show the fields) | 02 |
| The purposes in this plan are `system`, set when the host adds a kind's system tunnel, and `person`, set on a `create` | (defaulted: the canvas plan adds `canvas`) | 02, 03 |
| A kind may give `system()`. After `listening`, the host calls it when the list holds no system tunnel of that kind, and creates what it answers | (defaulted: the host sets the purpose, so the host asks) | 01, 03 |
| The host calls `start` at boot and on `enable`, and `stop` on `disable` and when the daemon stops. A kind lists `start`, `stop` or `restart` only to offer them to a person | (defaulted: the host needs both to keep `enabled`, and an unlisted name is still not offered) | 01, 02 |
| A tunnel's settings are fields of its record. A secret field goes to the vault at `tunnel/<id>/<field>`, and a blank secret keeps the stored one | (defaulted: as a connector's) | 02 |
| `status`, `url`, `error` and `operation` live in the host's memory, and the channel merges them into each record | (defaulted: they change while the daemon runs, and a stored copy is stale after a restart) | 02 |
| `tunnel:read` reads the list | (defaulted: as `computer:read` and `connector:read`) | 02 |
| The setting is `tunnelHosts` in the daemon config, beside `origins` | (defaulted: the name) | 03 |
| The routes' `Host` check reads the list's URLs and the announced names. `say` stays for the system tunnel, so `ahpd status` keeps its line | (defaulted: nothing that reads `say` today changes) | 03, 04 |
| devtunnel keeps one Dev Tunnel for each connector, with the discovery labels. Each record is a port on it, with its own URL and anonymous access | (defaulted: a port added to a hosted tunnel keeps its clients connected) | 04 |
| devtunnel finds an existing tunnel by its `_ahpd` label and reuses it, so the derived connection token stays | (defaulted: the CLI path does the same) | 04 |
| The system tunnel is the port `31546`, forwarded to the daemon's port with the existing hop when the two differ | (defaulted: the port VS Code opens is fixed) | 04 |
| The option `anonymous` is the system tunnel's first value. After that the record holds it. `name` and `keep` stay options | (defaulted: a record is the one place a value is changed) | 04 |
| A tunnel names a host connector only | (defaulted: the `x-ahpd-connector` rule for an empty owner) | 04 |
| devtunnel's view shows the system tunnel as today, read through the SDK. The list on the view waits for the view's data plan | (defaulted: the view's data is a later plan) | 04 |

## Proposed architecture

- **Data flow** - A client invokes an operation. The host checks it, writes the record and calls the kind. The kind reports the status and the URL back to the host.
- **Event flow** - `listening` makes the host add each system tunnel and start the enabled ones. A record change sends `changed` to each subscriber. A list operation's status sends `x-ahpd-tunnels/operations`.
- **State flow** - The record, with its settings, `enabled`, `purpose` and `plugin`, is in the `tunnels` collection. Its secrets are in the vault. Its status is in the host's memory.
- **Layer responsibilities** - sdk: the kind, the operations and the tunnels channel · server: the wiring and the `Host` checks · tunnel-devtunnel: the devtunnel kind.
- **Source-of-truth files** - `packages/sdk/src/types/tunnels.ts`, `packages/sdk/src/tunnels/channel.ts` (both made by this plan).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A plugin registers a tunnel kind](task-01-a-plugin-registers-a-tunnel-kind.md) | done | - |
| [02 - The host lists tunnels and runs operations](task-02-the-host-lists-tunnels-and-runs-ops.md) | done | 01 |
| [03 - The daemon keeps the tunnels](task-03-the-daemon-keeps-the-tunnels.md) | done | 02 |
| [04 - devtunnel is a kind on the SDK](task-04-devtunnel-is-a-kind-on-the-sdk.md) | done | 01, 03 |

## Risks and tradeoffs

- A daemon that upgrades with no `devtunnel` connector loses its tunnel until a person signs in. The alert says so, and the doc says to sign in first.
- A tunnel made by a CLI signed in with another account is not found. The new tunnel has a new id, so each client derives a new token.
- The SDK pulls `websocket`, `axios` and native helpers with fallbacks. The Windows CI install must pass before the merge.
- A kind that throws in `create` leaves no record. A kind that throws in `start` leaves the record with `status: error`.
- The routes then answer to every URL in the list. A tunnel is the host's, and only `tunnel:put` adds one.

## Resume state

- **Done so far:** tasks 01 to 04 are done. ahpd #189 merged them as `01e7ca37`.
- **Next action:** none. The plan is built, and [implemented.md](implemented.md) records it. The checks by hand are in [plugin-1122-tunnel-checks.md](../../../pending/plugin-1122-tunnel-checks.md).
- **Open questions:** none. The `fromEnv` question and the `operation:invoke` check are in *Left for later* of [implemented.md](implemented.md).
- **Watch out for:** the system tunnel must keep the same Dev Tunnel id and the port `31546`, or every client that found it stops connecting.

## Final verification checklist

- [ ] `x-ahpd-tunnels://` lists the system tunnel with `purpose: system`, its URL and `status: running`.
- [ ] VS Code and ahpc reach the daemon through the system tunnel with the token they derived before the upgrade.
- [ ] `x-ahpd/invokeOperation` with `devtunnel/create` and a port forwards it, and its URL answers.
- [ ] `disable` stops a tunnel and keeps it in the list. `enable` starts it, and a restart of the daemon starts it again.
- [ ] A caller without `tunnel:delete` cannot remove a tunnel.
- [ ] The routes answer to a tunnel's URL. The API does so only with `tunnelHosts` on.
- [ ] No `devtunnel` process runs, and the Windows CI is green.
