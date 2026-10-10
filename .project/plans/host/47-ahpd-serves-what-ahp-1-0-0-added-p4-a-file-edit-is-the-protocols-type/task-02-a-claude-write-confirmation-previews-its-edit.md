---
title: A Claude write confirmation previews the edit it would make
status: done
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

- **Implemented** 2026-10-09 on `build/agents/5860f22a`, after task 01.
- **The port.** `ChangesetSource` gained `propose?(dir, session, toolCallId, path, apply)` and `settle?(session, toolCallId)`. `propose` reads the file, calls `apply`, and answers one `FileEdit`. An absent file reaches `apply` as `undefined`. `before` is the `file:` URI of the file, and only when it is there. `after` is a URI the port mints. `settle` drops the text, and no `diff` is built.
- **Where the text lives.** `packages/sdk/src/changes.ts` holds it in a `Map` keyed by `${session}\u0000${toolCallId}`, because `settle` is given no path to key a URI by. `pendingUri` copies `capturedUri`'s shape with `pending/` where the turn's scope was. `read` answers that map before it looks at the scheme, which is what makes the URI the host's own.
- **The seams.** `Start.onEditProposed?(toolCallId, path, apply)` and `Start.onEditSettled?(toolCallId)` sit beside `onFileEdit` in `types/agent.ts` and `types/session.ts`. `packages/sdk/src/host/spawn.ts` wires both to `options.changes`, and gets the directory from the session URI the way `onFileEdit` does.
- **What each tool proposes.** `writeOf(name, input)` in `packages/agent-claude/src/input.ts` answers a path and an `apply` for `Write`, `Edit` and `MultiEdit`, and nothing for any other tool. `Edit` replaces the first occurrence, or every one when `replace_all` is true, and answers `undefined` when the string is not in the file. `MultiEdit` applies its list in order.
- **When it is asked for.** `packages/agent-claude/src/session/asking.ts` builds the preview before the confirmation goes out, so the card carries it. The same code keeps the call's id in a `Set`. The id and the preview sit above the `new Promise` the ask returns, because that executor is not async. The `Set` is what the seams are keyed by, so a preview is settled once.
- **The four settle points.** The person's answer (`confirm`, for approval and refusal alike), `turns.cancel`, the `result` frame in `query.ts`, and `session.close`. Each calls `settleEdits`.
- **Departure from the plan's Files list.** The plan named `packages/agent-claude/src/session.ts` for the confirmation. That file is now a composition of `session/*.ts` after the claude/18 split, so the work landed in `input.ts` and `session/{asking,turns,query}.ts`. `session.ts` carries only the close hook. `claude.ts` passes the two options through as the plan said.
- **Tests.** `packages/agent-claude/test/agent-claude-edit-preview.test.ts` is new: nine cases, on the hoisted SDK fake from `agent-claude-tool-input.test.ts`, wired to the real changes port rather than a stand-in. `packages/sdk/test/changes-uris.test.ts` gained a fifth `ahp-edit://pending` case, which reads a proposed URI through the host's own `resourceRead`.
- **One case takes the last `chat/toolCallReady`, not the first.** The assistant message announces a call ready as `not-needed` before anybody is asked. The question is the second one for that id.
- **The `before` side is not the port's.** It is a `file:` URI the host answers from its filesystem, so a test reads it with `readFileSync`. Only the side the tool would leave goes through the port.
- **Validation.** `pnpm install`, `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck`, `pnpm boundary` and the full `vitest run --maxWorkers=2 --testTimeout=10000` all pass: 266 files, 4698 tests.
- **Not done:** nothing was set `done` and nothing was committed.
