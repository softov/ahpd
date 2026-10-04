---
title: Every gated method and client action needs one operation
status: todo
depends: [task-01-operations-and-groups-are-one-table.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L158-L249](../../../../packages/sdk/src/host.ts#L158-L249) - `NEEDS`"
  - "[code://packages/sdk/src/host.ts#L307-L318](../../../../packages/sdk/src/host.ts#L307-L318) - `dispatchNeeds`"
  - "[code://packages/sdk/src/host.ts#L341-L367](../../../../packages/sdk/src/host.ts#L341-L367) - `seesConfig` and `ACTION_HOMES`"
  - "[code://packages/sdk/src/host.ts#L7347-L7399](../../../../packages/sdk/src/host.ts#L7347-L7399) - `capabilityFor`"
  - "[code://packages/sdk/src/host.ts#L9732-L9757](../../../../packages/sdk/src/host.ts#L9732-L9757) - the dispatch gate"
  - "[code://packages/sdk/src/host.ts#L8943-L8990](../../../../packages/sdk/src/host.ts#L8943-L8990) - `createChat`, whose `source.kind` is `fork` or `sideChat`"
  - "[code://packages/sdk/test/users-gate.test.ts#L140-L168](../../../../packages/sdk/test/users-gate.test.ts#L140-L168) - the staleness test"
  - npm://@microsoft/agent-host-protocol@1.0.0 - `IS_CLIENT_DISPATCHABLE` (`src/types/action-origin.generated.ts:462`), the 47 actions below
---

## Objective

`NEEDS` maps each gated method to one `subject:operation`, a new `ACTION_NEEDS` maps each client-dispatchable action type to one, and the gate asks for those; with the built-in roles every answer is the same as before.

## Files

- `UPDATE: packages/sdk/src/host.ts:158-249` - `NEEDS` per the table.
- `UPDATE: packages/sdk/src/host.ts:307-367` - `dispatchNeeds` keeps only the two channel rules no action type can say (the root's per-connection keys, and `file:watch` for a channel that is neither a session's, a terminal's nor the automations'); `ACTION_HOMES` keeps `home`, which still refuses an action on the wrong kind of channel, and drops `needs`; `ACTION_NEEDS` beside it.
- `UPDATE: packages/sdk/src/host.ts:7347-7399` - `capabilityFor` answers `subscribe` and `completions` with operations; `createChat` with `source.kind: 'fork'` asks `chat:fork`.
- `UPDATE: packages/sdk/src/host.ts:9732-9757` - the gate asks `ACTION_NEEDS[action.type]`.
- `UPDATE: packages/sdk/test/users-gate.test.ts` - the staleness test and the matrix below.
- Comments citing `a-grant-is-a-subject-and-a-verb` cite `a-grant-names-an-operation-and-read-and-write-are-its-groups`.

## Steps

1. Apply the table. A resource method's subject is still the URI's scheme (`resourceDelete` on `computer://x` asks `computer:delete`, `resourceRead` on `user://x` asks `user:get`, `resourceWrite` on `role://x` asks `role:put`). `read` and `write` never appear in the Operation column; they are only the groups.
2. `subscribe` and `completions` keep asking for the channel as spelt and as resolved, each by its operation; `invokeChangesetOperation` asks `session:changes` and keeps `file:write`.
3. `seesConfig` asks `config:read`; `root/configChanged` with only `PER_CONNECTION` keys still needs nothing.
4. An action type with no row in `ACTION_NEEDS` is refused, as one with no family is today.

| Method or action | Operation | Group |
| --- | --- | --- |
| `resourceRead` | `file:get` | read |
| `resourceList`; `completions` with no channel | `file:list` | read |
| `resourceResolve` | `file:resolve` | read |
| `createResourceWatch`; `subscribe` to a file, watch or relayed channel; a dispatch on one | `file:watch` | read |
| `resourceWrite` | `file:put` | write |
| `resourceDelete` | `file:delete` | write |
| `resourceMkdir` | `file:mkdir` | write |
| `resourceMove` | `file:move` | write |
| `resourceCopy` | `file:copy` | write |
| `resourceRequest` | `file:request` | write |
| `listSessions` | `session:list` | read |
| `subscribe` to a session, annotations or changeset channel; `resolveSessionConfig`; `sessionConfigCompletions`; `completions` in a session; `vscode/getAgentHostSessionStateFile` | `session:read` | read |
| `createSession` | `session:create` | write |
| `disposeSession` | `session:dispose` | write |
| `session/titleChanged` | `session:rename` | write |
| `session/configChanged`, `session/customizationToggled`, `session/mcpServerStartRequested`, `session/mcpServerStopRequested`, `session/mcpServerBackgroundRequested` | `session:configure` | write |
| `session/workingDirectorySet`, `session/workingDirectoryRemoved`, `session/workingDirectoryReplaced` | `session:folders` | write |
| `session/activeClientSet`, `session/activeClientRemoved` | `session:attach` | write |
| `session/isReadChanged`, `session/isArchivedChanged` | `session:mark` | write |
| `changeset/filesReviewChanged`, `annotations/set`, `annotations/updated`, `annotations/removed`, `annotations/entrySet`, `annotations/entryRemoved` | `session:review` | write |
| `invokeChangesetOperation` | `session:changes` (and `file:write`) | write |
| `vscode/createAgentHostDetachedWorktree`, `vscode/claimAgentHostDetachedWorktree`, `vscode/setAgentHostDetachedWorktreeArchived`, `vscode/deleteAgentHostDetachedWorktree`, `vscode/reconcileAgentHostDetachedWorktrees` | `session:worktree` | write |
| `vscode/removeSessionArtifact` | `session:artifacts` | write |
| `subscribe` to a chat channel; `fetchTurns` | `chat:read` | read |
| `createChat`; `createChat` with `source.kind: 'sideChat'` | `chat:create` | write |
| `createChat` with `source.kind: 'fork'` | `chat:fork` | write |
| `disposeChat` | `chat:dispose` | write |
| `moveChat` (1.0.0, once served) | `chat:move` | write |
| `chat/turnStarted`, `chat/turnResume`, `chat/pendingMessageSet`, `chat/pendingMessageRemoved`, `chat/queuedMessagesReordered` | `chat:send` | write |
| `chat/turnCancelled` | `chat:cancel` | write |
| `chat/toolCallConfirmed`, `chat/toolCallResultConfirmed`, `chat/inputAnswerChanged`, `chat/inputCompleted` | `chat:answer` | write |
| `chat/toolCallComplete`, `chat/toolCallContentChanged` | `chat:tool` | write |
| `chat/draftChanged` | `chat:draft` | write |
| `chat/workingDirectorySet`, `chat/workingDirectoryRemoved` | `chat:folders` | write |
| `chat/isReadChanged` (1.0.0), `chat/isArchivedChanged` | `chat:mark` | write |
| `chat/truncated` | `chat:truncate` | write |
| `subscribe` to a terminal channel | `terminal:read` | read |
| `createTerminal` | `terminal:create` | write |
| `disposeTerminal` | `terminal:dispose` | write |
| `terminal/input` | `terminal:input` | write |
| `terminal/resized` | `terminal:resize` | write |
| `terminal/claimed` | `terminal:claim` | write |
| `terminal/titleChanged` | `terminal:rename` | write |
| `terminal/cleared` | `terminal:clear` | write |
| `subscribe` to `ahp-automations://` or a run channel; `listAutomationTriggerDefinitions`; `fetchAutomationRuns` | `automation:read` | read |
| `automation/createRequested` | `automation:create` | write |
| `automation/updateRequested` | `automation:update` | write |
| `automation/removed` | `automation:remove` | write |
| `runAutomation` | `automation:run` | write |
| `automationRun/cancelRequested` | `automation:cancel` | write |
| the daemon's keys in root state (`seesConfig`) | `config:read` | read |
| `root/configChanged` with a host or daemon key, or `replace` | `config:write` | write |
| `vscode/collectAgentHostDebugLogs`, `vscode/readAgentHostDebugLogsChunk` | `diagnostics:logs` | read |
| `getNetworkDiagnosticsInfo` | `diagnostics:network` | read |
| `diagnosticsFetch` | `diagnostics:fetch` | read |
| `vscode/devContainers/connect` | `container:connect` | write |
| `vscode/devContainers/disconnect` | `container:disconnect` | write |
| `vscode/devContainers/relaySend` | `container:relay` | write |

Ungated, as today: `initialize`, `reconnect`, `ping`, `authenticate`, `unsubscribe`, `subscribe` to the root, `vscode/devContainers/isDockerAvailable`, and `root/configChanged` carrying only `PER_CONNECTION` keys.

## Validation

- `packages/sdk/test/users-gate.test.ts`, staleness: every served method is in `NEEDS` or `UNGATED`, and every action type `IS_CLIENT_DISPATCHABLE` marks `true` has a row in `ACTION_NEEDS`; the check fails on a made-up action type.
- The same file, matrix: for `admin`, `member`, `guest` and the `operators` role in `docs/USERS.md`, every method and every action is allowed or refused exactly as on `main` before this task (record the answers from `main` into the test first).
- The same file: a role of `['session:read', 'chat:send']` can dispatch `chat/turnStarted` and is refused `disposeSession` with `may not session:dispose`; a role of `['automation:read', 'automation:update']` can dispatch `automation/updateRequested` and is refused `runAutomation`; `['session:write']` may fork a chat; a role of `['user:get']` can `resourceRead` a `user://` record and is refused `resourceList` on `user://`, while `['user:read']` can do both.
- `pnpm test` passes.

## Resume
