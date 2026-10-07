---
title: A session asks the client before it moves into a folder
status: done
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

Before a session moves into a folder, the host asks the connection that asked for the move.
The same happens when a client adds a folder (`session/workingDirectorySet`).
The host sends `vscode/requestWorkspaceTrust` `{ workspace }` when the folder is outside that connection's `trustedUris`.
The move goes ahead only on `{ trusted: true }`, and anything else, an error or a disconnect, refuses it with `Workspace trust was not granted for <folder>`.
A move that names a repository asks about the repository alone.
A worktree the host makes there inherits its repository's trust ([the decision](../../../decisions/a-worktree-inherits-its-repositorys-trust.md)).
The host sends no request when root config's `globalAutoApproveEnabled` is true or the session's `autoApprove` is `autoApprove`.

## Files

- `UPDATE: packages/sdk/src/host/tooling.ts:338-340` - `moving` records the connection that sent the turn; today it records the chat, directory and isolation only.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:531-553` - `moveSession` asks before `restart`; today it moves into any folder the agent names, trusted or not.
- `UPDATE: packages/sdk/src/host/chatactions.ts:335-360` - the same for `session/workingDirectorySet`, refused with the sentence above.
- `UPDATE: packages/sdk/test/host-files.test.ts` and the move cases in `packages/sdk/test/plugin-host.test.ts` - the cases below.

## Steps

1. Failing case first: a client with `trustedUris` `[/a]`; the agent calls `setWorkspace('/b')`; the client answers `{ trusted: false }`. Expect the session to stay where it was and the host to log the failure; today it moves.
2. The same client answers `{ trusted: true }`: the session moves.
3. A client that does not serve the method (answers `-32601`): the host refuses the move.
4. `globalAutoApproveEnabled: true` in root config: no request, the move happens.
5. An isolated move asks about the repository once, and nothing about the worktree.
6. `session/workingDirectorySet` of `/b`, client says no: the host refuses the action and adds no folder.
7. A yes once given keeps the folder trusted for the backend the move restarts.
8. A folder written as `<trusted>/../../etc`: the host asks about the folder it names, not the text.

## Validation

- Steps 1, 3 and 6 fail on `e1c4ccc` and pass after.
- `pnpm exec vitest run packages/sdk`.

## Resume
