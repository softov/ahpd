---
title: VS Code's stop and remove reach the folder's computer
status: todo
depends: []
layer: "sdk | computer"
refs:
  - "[code://packages/sdk/src/host.ts#L184-L186](../../../../packages/sdk/src/host.ts#L184-L186) - the `container:write` rows of `NEEDS` for the dev container methods"
  - "[code://packages/sdk/src/host.ts#L9154-L9267](../../../../packages/sdk/src/host.ts#L9154-L9267) - the `vscode/devContainers/*` handlers, `disconnect` at :9247"
  - "[code://packages/sdk/src/host.ts#L7353](../../../../packages/sdk/src/host.ts#L7353) - `containers`, one connection's relays"
  - "[code://packages/sdk/src/types/containers.ts#L87-L122](../../../../packages/sdk/src/types/containers.ts#L87-L122) - `ContainerPort`"
  - "[code://packages/computer/src/plugin.ts#L839-L840](../../../../packages/computer/src/plugin.ts#L839-L840) - `machineFor`, the computer a folder already is"
  - "[code://packages/computer/src/plugin.ts#L441-L453](../../../../packages/computer/src/plugin.ts#L441-L453) - the runtime's `stop` and `remove`, wrapped so the up-time and the owner close"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/common/agentHostExtensionProtocol.ts#L27-L28 - `vscode/devContainers/stop` and `vscode/devContainers/remove`, with `{ workspaceFolder }` params
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/devContainerAgentHostService.ts#L919-L953 - the reference host: disconnect the folder's relays, then `docker stop` or `docker rm --force`, and answer `false` while another client still uses the container
---

## Objective

ahpd serves `vscode/devContainers/stop` and `vscode/devContainers/remove` under VS Code's own names: each takes `{ workspaceFolder }`, ends the asking connection's relays to that folder's computer, stops or removes the computer, and answers `true`; it answers `true` when the folder has no computer, and `false` when another connection still has a relay to it, as VS Code's reference host does.

## Files

- `UPDATE: packages/sdk/src/types/containers.ts:87-122` - `ContainerPort` gains optional `stop(folder)` and `remove(folder)`, each answering whether it acted.
- `UPDATE: packages/sdk/src/host.ts:184-186` - both methods need `container:write`, like `connect`.
- `UPDATE: packages/sdk/src/host.ts:9154-9267` - the two handlers: check `workspaceFolder` is an absolute path; answer `false` when another connection holds a relay for that folder, which needs a view of the relays across connections; otherwise end the asking connection's relays for it and call the port; a port without the member is refused the way an absent launcher is.
- `UPDATE: packages/computer/src/plugin.ts:856-878` - the registered port implements both through `machineFor` and the wrapped `stop` and `remove` (`:441-453`), so a removed computer's up-time and owner entry close as they do for a `computer://` delete.
- `UPDATE: packages/computer/test/devcontainer.test.ts` and `packages/sdk/test` - the cases below.

## Steps

1. Take the method names and param shape from VS Code's `agentHostExtensionProtocol.ts`; the answer is a boolean, as there.
2. `remove` removes the container and never the folder or its `devcontainer.json`.
3. VS Code asks its client for workspace trust before either; here the `container:write` grant is the gate, and nothing asks the client.

## Validation

- A folder with a computer and one relay: `stop` ends the relay, the fake Docker shows the machine stopped, and the answer is `true`; today the method is not found.
- `remove` on the same folder leaves no machine and no `computers.json` entry.
- A folder with no computer answers `true` and runs nothing.
- A second connection's relay to the same folder makes `stop` answer `false` and leaves the computer running.
- A principal without `container:write` is refused.

## Resume
