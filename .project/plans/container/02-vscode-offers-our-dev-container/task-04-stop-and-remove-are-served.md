---
title: VS Code's stop and remove reach the folder's computer
status: todo
depends: []
layer: "sdk | computer"
refs:
  - "[code://packages/sdk/src/host.ts#L185-L187](../../../../packages/sdk/src/host.ts#L185-L187) - the `container:write` rows of `NEEDS` for the dev container methods"
  - "[code://packages/sdk/src/host.ts#L9270-L9384](../../../../packages/sdk/src/host.ts#L9270-L9384) - the `vscode/devContainers/*` handlers, `disconnect` at :9363"
  - "[code://packages/sdk/src/host.ts#L7473](../../../../packages/sdk/src/host.ts#L7473) - `containers`, one connection's relays"
  - "[code://packages/sdk/src/host.ts#L1716](../../../../packages/sdk/src/host.ts#L1716) - `sessionMachines`, the sessions placed on each machine"
  - "[code://packages/sdk/src/types/containers.ts#L87-L122](../../../../packages/sdk/src/types/containers.ts#L87-L122) - `ContainerPort`"
  - "[code://packages/computer/src/plugin.ts#L913-L914](../../../../packages/computer/src/plugin.ts#L913-L914) - `machineFor`, the computer a folder already is"
  - "[code://packages/computer/src/plugin.ts#L930-L952](../../../../packages/computer/src/plugin.ts#L930-L952) - the registered container port"
  - "[code://packages/computer/src/plugin.ts#L485-L497](../../../../packages/computer/src/plugin.ts#L485-L497) - the runtime's `stop` and `remove`, wrapped so the up-time and the owner close"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/common/agentHostExtensionProtocol.ts#L27-L28 - `vscode/devContainers/stop` and `vscode/devContainers/remove`, with `{ workspaceFolder }` params
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/devContainerAgentHostService.ts#L919-L953 - the reference host: disconnect the folder's relays, then `docker stop` or `docker rm --force`, and answer `false` while another client still uses the container
---

## Objective

ahpd serves `vscode/devContainers/stop` and `vscode/devContainers/remove` under VS Code's own names: each takes `{ workspaceFolder }`, ends the asking connection's relays to that folder's computer, stops or removes the computer, and answers `true`; it answers `true` when the folder has no computer, and `false` when another connection still has a relay to it, as VS Code's reference host does.
After container/03 that computer is a shared computer that ahpd sessions are placed on, so it also answers `false` while any session is placed on it.
The permission this needs beyond `container:write` waits on the open question in the plan's *Resume state*.

## Files

- `UPDATE: packages/sdk/src/types/containers.ts:87-122` - `ContainerPort` gains optional `stop(folder)` and `remove(folder)`, each answering whether it acted.
- `UPDATE: packages/sdk/src/host.ts:185-187` - both methods need `container:write`, like `connect`; whether they also need `computer:write` (plugin/16) and an owner check waits on the plan's open question.
- `UPDATE: packages/sdk/src/host.ts:9270-9384` - the two handlers: check `workspaceFolder` is an absolute path; answer `false` when another connection holds a relay for that folder, which needs a view of the relays across connections, or when any session is placed on that folder's computer (`sessionMachines`, `:1716`); otherwise end the asking connection's relays for it and call the port; a port without the member is refused the way an absent launcher is.
- `UPDATE: packages/computer/src/plugin.ts:930-952` - the registered port implements both through `machineFor` (`:913`) and the wrapped `stop` and `remove` (`:485-497`), so a removed computer's up-time and owner entry close as they do for a `computer://` delete.
- `UPDATE: packages/computer/test/devcontainer.test.ts` and `packages/sdk/test` - the cases below.

## Steps

1. Take the method names and param shape from VS Code's `agentHostExtensionProtocol.ts`; the answer is a boolean, as there.
2. `remove` removes the container and never the folder or its `devcontainer.json`.
3. VS Code asks its client for workspace trust before either; here the grant is the gate, and nothing asks the client.
4. Build after container/03 and plugin/16 have landed: the computer a folder is, and the sessions placed on it, come from container/03, and the `computer:write` gate and the machine's owner from plugin/16.
5. The permission check (`container:write` and `computer:write`, or those and ownership) waits on the plan's open question; do not write it until that is answered.

## Validation

- A folder with a computer and one relay: `stop` ends the relay, the fake Docker shows the machine stopped, and the answer is `true`; today the method is not found.
- `remove` on the same folder leaves no machine and no `computers.json` entry.
- A folder with no computer answers `true` and runs nothing.
- A second connection's relay to the same folder makes `stop` answer `false` and leaves the computer running.
- A session placed on the folder's computer makes `stop` and `remove` answer `false` and leaves the computer as it was.
- A principal without `container:write` is refused.

## Resume
