---
title: A session asks the client before it moves into a folder
status: todo
depends: [task-02-workspacetrust-is-kept-per-connection.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/tooling.ts#L338-L340](../../../../packages/sdk/src/host/tooling.ts#L338-L340) - `setWorkspace`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L531-L553](../../../../packages/sdk/src/host/lifecycle.ts#L531-L553) - `moveSession`"
  - "[code://packages/sdk/src/host/chatactions.ts#L335-L337](../../../../packages/sdk/src/host/chatactions.ts#L335-L337) - `session/workingDirectorySet`"
  - "[code://packages/sdk/src/host/relay.ts#L63](../../../../packages/sdk/src/host/relay.ts#L63) - `peer.request`"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/chatContributions/sessionWorkspaceConversion/sessionWorkspaceConversionService.ts#L322-L333 - `_requireWorkspaceTrust`
---

## Objective

Before a session moves into a folder (the agent's `setWorkspace`) or a client adds one (`session/workingDirectorySet`), and the folder is outside the asking connection's `trustedUris`, the host sends that connection `vscode/requestWorkspaceTrust` `{ workspace }`; for an isolated move it asks for the repository and then for the worktree with `trustedParent` set to the repository.
It goes ahead only on `{ trusted: true }`; anything else, an error or a disconnect refuses it with `Workspace trust was not granted for <folder>`.
No request is sent when root config's `globalAutoApproveEnabled` is true or the session's `autoApprove` is `autoApprove`.

## Files

- `UPDATE: packages/sdk/src/host/tooling.ts:338-340` - `moving` records the connection that sent the turn; today it records the chat, directory and isolation only.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:531-553` - `moveSession` asks before `restart`; today it moves into any folder the agent names, trusted or not.
- `UPDATE: packages/sdk/src/host/chatactions.ts:335-360` - the same for `session/workingDirectorySet`, refused with the sentence above.
- `UPDATE: packages/sdk/test/host-files.test.ts` and the move cases in `packages/sdk/test/plugin-host.test.ts` - the cases below.

## Steps

1. Failing case first: a client with `trustedUris` `[/a]`; the agent calls `setWorkspace('/b')`; the client answers `{ trusted: false }`. Today the session moves; after, it stays in its folder and the failure is logged.
2. The same client answers `{ trusted: true }`: the session moves.
3. A client that does not serve the method (answers `-32601`): refused.
4. `globalAutoApproveEnabled: true` in root config: no request, the move happens.
5. An isolated move asks twice, the second with `trustedParent`.
6. `session/workingDirectorySet` of `/b`, client says no: the action is refused and the folder is not added.

## Validation

- Steps 1, 3 and 6 fail on `e1c4ccc` and pass after.
- `pnpm exec vitest run packages/sdk`.

## Resume
