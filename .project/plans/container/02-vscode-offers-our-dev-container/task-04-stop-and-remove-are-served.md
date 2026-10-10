---
title: VS Code's stop and remove reach the folder's computer
status: done
depends: []
layer: "sdk | computer | docs"
refs:
  - "[code://packages/sdk/src/host/gate.ts#L76-L92](../../../../packages/sdk/src/host/gate.ts#L76-L92) - the `NEEDS` rows for the dev container methods"
  - "[code://packages/sdk/src/host/vscodemethods.ts#L477-L603](../../../../packages/sdk/src/host/vscodemethods.ts#L477-L603) - the `vscode/devContainers/*` handlers, `disconnect` at :570"
  - "[code://packages/sdk/src/host/context.ts#L341](../../../../packages/sdk/src/host/context.ts#L341) - `containers`, one connection's relays"
  - "[code://packages/sdk/src/host/context.ts#L55-L67](../../../../packages/sdk/src/host/context.ts#L55-L67) - `relays`, the same maps held across connections"
  - "[code://packages/sdk/src/host/machines.ts#L16](../../../../packages/sdk/src/host/machines.ts#L16) - `sessionMachines`, the sessions placed on each machine"
  - "[code://packages/sdk/src/types/containers.ts#L122-L147](../../../../packages/sdk/src/types/containers.ts#L122-L147) - the `stop` and `remove` members of `ContainerPort`"
  - "[code://packages/computer/src/plugin.ts#L1746](../../../../packages/computer/src/plugin.ts#L1746) - `machineFor`, the computer a folder already is"
  - "[code://packages/computer/src/plugin.ts#L1795-L1846](../../../../packages/computer/src/plugin.ts#L1795-L1846) - the registered container port"
  - "[code://packages/computer/src/plugin.ts#L850-L867](../../../../packages/computer/src/plugin.ts#L850-L867) - the runtime's `stop` and `remove`, wrapped so the up-time and the owner close"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/common/agentHostExtensionProtocol.ts#L27-L28 - `vscode/devContainers/stop` and `vscode/devContainers/remove`, with `{ workspaceFolder }` params
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/devContainerAgentHostService.ts#L919-L953 - the reference host: disconnect the folder's relays, then `docker stop` or `docker rm --force`, and answer `false` while another client still uses the container
---

## Objective

ahpd serves `vscode/devContainers/stop` and `vscode/devContainers/remove` under VS Code's own names: each takes `{ workspaceFolder }`, ends the asking connection's relays to that folder's computer, stops or removes the computer, and answers `true`; it answers `true` when the folder has no computer, and `false` when another connection still has a relay to it, as VS Code's reference host does.
After container/03 that computer is a shared computer that ahpd sessions are placed on, so it also answers `false` while any session is placed on it.
Each method needs `container:stop` or `container:remove` and `computer:write` beside it, and no owner check - decision `stopping-a-dev-container-needs-the-computers-grant`.

## Files

- `UPDATE: packages/sdk/src/types/containers.ts:122-147` - `ContainerPort` gains optional `stop(folder)` and `remove(folder)`, each answering whether it acted.
- `UPDATE: packages/sdk/src/users.ts:168-173` - the `container` subject gains `stop` and `remove`, both in the write group.
- `UPDATE: packages/sdk/src/host/gate.ts:91-92` - `vscode/devContainers/stop` needs `container:stop` and `vscode/devContainers/remove` needs `container:remove`.
- `UPDATE: packages/sdk/src/host/admission.ts:121-122` - `capabilityFor` asks `computer:write` beside each, as it does for `createSession`.
- `UPDATE: packages/sdk/src/host/context.ts:55-67` - `relays`, one connection's relay map held where a handler for another connection can see it.
- `UPDATE: packages/sdk/src/host.ts` - the `relays` map is filled in `accept` and dropped in `close`.
- `UPDATE: packages/sdk/src/host/vscodemethods.ts:149-227` - `devFolder`, `atPath`, `relayedByAnother`, `placedOn` and the `devContainerStopped` handler body: the folder check, the two refusals and the port call.
- `UPDATE: packages/sdk/src/host/vscodemethods.ts:602-603` - the `stop` and `remove` handlers, which the table is built from.
- `UPDATE: packages/computer/src/plugin.ts:1795-1846` - the registered port implements both through `machineFor` and the wrapped `stop` and `remove`, so a removed computer's up-time and owner entry close as they do for a `computer://` delete.
- `UPDATE: packages/sdk/test/containers.test.ts` - the sdk cases below: the folder check, another connection's relay, a port without the member, and the grants.
- `UPDATE: packages/computer/test/computer-devcontainer.test.ts` - the computer cases below: a stop after a relay, a remove with its record, and a session's hold on the folder.
- `UPDATE: packages/sdk/test/users-gate-tables.test.ts:9` - `SERVED` raised to 49, one per method the two handlers add.
- `UPDATE: packages/sdk/test/wire.test.ts:674-675` - both methods in `DEPARTURES`, which the document check reads back.
- `UPDATE: docs/USERS.md:138` - the `container` row lists all five operations.
- `UPDATE: docs/CONTAINERS.md:110-132` - the surface table gains both methods with their grants and answers.
- `UPDATE: docs/AHP.md:864-865` - both methods in "What is served outside the protocol".
- `CREATE: .project/decisions/stopping-a-dev-container-needs-the-computers-grant.md` - the decision both grants come from.

## Steps

1. Take the method names and param shape from VS Code's `agentHostExtensionProtocol.ts`; the answer is a boolean, as there.
2. `remove` removes the container and never the folder or its `devcontainer.json`.
3. VS Code asks its client for workspace trust before either; here the grant is the gate, and nothing asks the client.
4. Build after container/03 and plugin/16 have landed: the computer a folder is, and the sessions placed on it, come from container/03, and the `computer:write` gate and the machine's owner from plugin/16.
5. Ask for `container:stop` or `container:remove` and `computer:write` beside it, with no owner check: decision `stopping-a-dev-container-needs-the-computers-grant`.

## Validation

- A folder with a computer and one relay: `stop` ends the relay, the fake Docker shows the machine stopped, and the answer is `true`.
- `remove` on the same folder leaves no machine and no `computers.json` entry.
- A folder with no computer answers `true` and runs nothing.
- A second connection's relay to the same folder makes `stop` answer `false` and leaves the computer running.
- A session placed on the folder's computer makes `stop` and `remove` answer `false` and leaves the computer as it was.
- A principal without `container:write` is refused.

## Resume

2026-10-10: implemented, reviewed and done. Both handlers are served, both grants are asked for, and the docs, the gate table and the wire's departure list name them.
The permission question was answered on 2026-10-10 and the answer is the decision file named in *Files*.
Two departures from the plan.
The plan named `packages/computer/test/devcontainer.test.ts`, which does not exist: the computer cases went into `packages/computer/test/computer-devcontainer.test.ts`, beside the ones this surface already had.
The sdk cases went into `packages/sdk/test/containers.test.ts`, so both halves of the surface are tested where the surface is.
The cross-connection view is a host-wide map of the relays, filled in `accept` and dropped in `close`, rather than a lookup under the connections.
One limitation, found while testing: `placedOn` matches a session by the source it was given.
A session placed with `computer: 'devcontainer://<folder>'` holds the container.
One that named the machine as `computer://<id>` does not.
It is recorded in [the stop problem](../../../problems/a-dev-container-stop-misses-a-session-placed-by-computer-uri.md).
Verified: `packages/sdk/test/containers.test.ts` 13 cases, `packages/computer/test/computer-devcontainer.test.ts` 43 cases, and the full suite green.
