---
title: A Claude write confirmation previews the edit it would make
status: todo
depends: [task-01-ahpds-file-edits-are-the-protocols-types.md]
layer: "sdk, agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1254-L1259](../../../../packages/agent-claude/src/session.ts#L1254-L1259) - `edits`, the tools that write a named file and the path each names"
  - "[code://packages/agent-claude/src/session.ts#L2090-L2152](../../../../packages/agent-claude/src/session.ts#L2090-L2152) - a permission ask becomes `pending-confirmation` and `chat/toolCallReady`, with no `edits`"
  - "[code://packages/agent-claude/src/session.ts#L3636](../../../../packages/agent-claude/src/session.ts#L3636) - `chat/toolCallConfirmed`, where an ask is settled"
  - "[code://packages/sdk/src/types/agent.ts#L272](../../../../packages/sdk/src/types/agent.ts#L272) - `Start.onFileEdit`, the seam a backend already uses to hand the host a file's sides"
  - "[code://packages/sdk/src/host/spawn.ts#L639-L643](../../../../packages/sdk/src/host/spawn.ts#L639-L643) - the host passes `onFileEdit` to the changes port's `observe`"
  - "[code://packages/sdk/src/types/changes.ts#L260-L320](../../../../packages/sdk/src/types/changes.ts#L260-L320) - `ChangesetSource`: `read` and `observe`"
  - "[code://packages/sdk/src/changes.ts#L190-L196](../../../../packages/sdk/src/changes.ts#L190-L196) - `ahp-edit:`, the scheme for a captured side the host holds and serves"
  - "[code://packages/sdk/src/changes.ts#L399-L407](../../../../packages/sdk/src/changes.ts#L399-L407) - `capturedUri`, the URI shape a pending side copies"
  - "[code://packages/sdk/src/changes.ts#L960-L966](../../../../packages/sdk/src/changes.ts#L960-L966) - `read` serves a held side"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L5555-L5612 - `_buildEditsForPermission`: `before` is the file on disk when it exists, `after` is the proposed text written to `pending-edit-content:` for the client to `resourceRead`, `diff` from the request's unified diff, one item; dropped when the request settles"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L5039-L5100 - the preview is built before the confirmation is sent and rides `edits` on the pending state"
---

## Objective

When the Claude backend asks a person to approve `Write`, `Edit` or `MultiEdit`, the confirmation carries `edits`: one `FileEdit` whose `before` is the file as it is (absent for a new file) and whose `after` is the text the tool would leave, served by the host under `ahp-edit:` until the call is settled, so a client shows the diff before the person decides, as VS Code's Copilot backend does.

## Files

- `UPDATE: packages/sdk/src/types/changes.ts` - `ChangesetSource.propose?(dir, session, toolCallId, path, apply: (current: string | undefined) => string | undefined): Promise<FileEdit | undefined>` and `settle?(session, toolCallId): void`.
- `UPDATE: packages/sdk/src/changes.ts` - `propose` reads the file, calls `apply`, holds the result under `ahp-edit://pending/<session base64url>/<toolCallId>/<path>` and answers the `FileEdit`; `read` serves it; `settle` drops it, and forgetting a session drops its pending sides.
- `UPDATE: packages/sdk/src/types/agent.ts`, `packages/sdk/src/types/session.ts`, `packages/sdk/src/host/spawn.ts` - `Start.onEditProposed?(toolCallId, path, apply)` and `Start.onEditSettled?(toolCallId)`, wired to the port beside `onFileEdit`.
- `UPDATE: packages/agent-claude/src/claude.ts`, `packages/agent-claude/src/session.ts` - pass the seams through; before `chat/toolCallReady` for those three tools, ask for the preview and put `{ items: [edit] }` on the action and on the call as `edits`; settle on confirm, deny, cancel and turn end.
- `CREATE: packages/agent-claude/test/agent-claude-edit-preview.test.ts` - the backend cases, on the fake SDK feed from `agent-claude-subagent.test.ts`.
- `UPDATE: packages/sdk/test/changes-uris.test.ts` - the port cases, in a temp directory.
- `UPDATE: docs/AHP.md` - the `chat/toolCallReady` row says a Claude write carries `edits`.

## Steps

1. `apply` per tool: `Write` returns `input.content`; `Edit` replaces `old_string` with `new_string` in the current text, every occurrence when `replace_all` is true and the first otherwise, and returns `undefined` when `old_string` is not found; `MultiEdit` applies its `edits` in order the same way and returns `undefined` if any is not found.
2. `apply` answering `undefined`, a missing seam, or a session with no folder means no `edits`; the confirmation goes out as today and is never held back.
3. `before` is `{ uri: file://<path>, content: { uri: file://<path> } }` only when the file exists, as VS Code builds it; `diff` is left out, because the Claude SDK gives no unified diff.
4. Settling drops the pending side, so a later `resourceRead` of its URI answers not found.

## Validation

- `packages/agent-claude/test/agent-claude-edit-preview.test.ts`: a `Write` ask for a new file sends `chat/toolCallReady` with one item that has no `before` and whose `after.content.uri` reads back as the written content; an `Edit` of an existing file has `before` on the file and an `after` with the one replacement; `replace_all` replaces every occurrence; a `MultiEdit` applies both edits in order; an `Edit` whose `old_string` is absent sends no `edits`; a `Bash` ask sends no `edits`; approving and denying each settle the preview once; with no seam the action is as today.
- `packages/sdk/test/changes-uris.test.ts`: `propose` on a file in a temp directory answers a `FileEdit` whose `after` URI `read` serves; after `settle` the same `read` answers `undefined`; a path that does not exist gives no `before`.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.

## Resume
