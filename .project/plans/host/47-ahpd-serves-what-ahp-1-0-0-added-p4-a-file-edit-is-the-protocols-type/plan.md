---
title: A file edit is the protocol's type, and a Claude write confirmation previews its edit
domain: host
status: built
priority: low
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/47-ahpd-serves-what-ahp-1-0-0-added/plan.md
  - plans/host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md
refs:
  - "[code://packages/sdk/src/types/changes.ts#L10-L27](../../../../packages/sdk/src/types/changes.ts#L10-L27) - ahpd's own `ContentRef` and `FileEdit`, the 0.9.0 inline shape written out by hand"
  - "[code://packages/sdk/src/types/changes.ts#L30-L33](../../../../packages/sdk/src/types/changes.ts#L30-L33) - `ChangesetFile.edit`, the one place ahpd builds a `FileEdit`"
  - "[code://packages/agent-acp/src/mapping.ts#L249-L254](../../../../packages/agent-acp/src/mapping.ts#L249-L254) - an ACP diff as a `fileEdit` tool result, typed as a `Bag`; `agent-acp` does not depend on the protocol package, and `@ahpd/sdk` does not export `FileEdit`"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `FileEditSide`, `FileEditDiffStats` and `FileEditCollection` name what 0.9.0 wrote inline; `FileEdit` is the same shape (`src/types/common/state.ts:273-308`); `edits?: FileEditCollection` on `chat/toolCallReady` and a pending confirmation is where a collection appears (`channels-chat/actions.ts:232`, `channels-chat/state.ts:1462`); `ToolResultFileEditContent extends FileEdit` (`channels-chat/state.ts:1683-1685`)"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/sessionPermissions.ts#L455 - VS Code passes a confirmation's `edits` through"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L5555-L5612 - only its Copilot backend builds them, `_buildEditsForPermission`; `node/claude/` sends none"
  - "[code://packages/agent-claude/src/session.ts#L2090-L2152](../../../../packages/agent-claude/src/session.ts#L2090-L2152) - the Claude backend's confirmation, which carries no `edits`"
  - "[code://packages/sdk/src/changes.ts#L190-L196](../../../../packages/sdk/src/changes.ts#L190-L196) - `ahp-edit:`, the host's scheme for a side it holds, which serves the proposed text"
---

## Goal

The file edits ahpd writes are typed with the protocol's own names, so the next change to the shape is a compile error here rather than a silent drift.
ahpd builds a `FileEdit` in a changeset row and in an ACP `fileEdit` tool result.
A Claude `Write`, `Edit` or `MultiEdit` that waits for approval carries the edit it would make as a `FileEditCollection`, so a client shows the diff before the person decides; VS Code's Copilot backend does this and its Claude backend does not, so this goes past VS Code's Claude backend.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "FileEdit|ContentRef|edits" packages/*/src` - the local types in `types/changes.ts`, used by `ChangesetFile`; the ACP mapping builds `fileEdit` content as a `Bag`; no `edits` on any confirmation.
- `grep -n "agent-host-protocol" packages/agent-acp/package.json` - only a keyword; typing the ACP mapping with the protocol's type would add a dependency, which is Softov's call, so it stays a `Bag`.
- `rg -n "edits: |FileEditCollection" src/vs/platform/agentHost` in the VS Code clone, generated protocol excluded - the pass-through in `sessionPermissions.ts` and the Copilot builder.
- `rg -n "pending-edit-content" src/vs/platform/agentHost` - Copilot's in-memory scheme for the proposed text, and `node/claude/CONTEXT.md:745`: Claude has no edit preview.
- `rg -n "ahp-edit:|observe" packages/sdk/src/changes.ts` - the host already holds captured sides under `ahp-edit:` and serves them through `read`, which is where a proposed side fits.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| `FileEdit` and `ContentRef` in `types/changes.ts` become the protocol's types, re-exported under the same names | (defaulted: 1.0.0 named the shapes, and a hand copy drifts) | 01 |
| ahpd's Claude backend attaches the proposed edit to `Write`, `Edit` and `MultiEdit` confirmations, in the shape VS Code's Copilot backend builds | Softov, 2026-10-03, asked "VS Code's Copilot backend attaches proposed file edits to a write tool's confirmation (a preview); its Claude backend does not. ahpd's Claude backend?": "Add it" | 02 |
| The proposed text is held by the changes port under `ahp-edit://pending/...` and dropped when the call is settled, where VS Code writes it to `pending-edit-content:` | (defaulted: `ahp-edit:` is ahpd's existing scheme for a side the host holds, so no new scheme or resource provider is added) | 02 |
| The preview has no `diff` counts, and a confirmation is never held back for want of a preview | (defaulted: the Claude SDK gives no unified diff to count, and VS Code's builder also answers nothing when it lacks a field) | 02 |
| ACP, pi and cofold attach no `edits` | (defaulted: Softov's answer names the Claude backend only) | - |
| The ACP mapping's `fileEdit` stays a `Bag` | (defaulted: typing it needs `agent-acp` to depend on the protocol package or `@ahpd/sdk` to export `FileEdit`, and neither is worth a dependency change for one return type) | - |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - ahpd's file edits are the protocol's types](task-01-ahpds-file-edits-are-the-protocols-types.md) | done | - |
| [02 - A Claude write confirmation previews the edit it would make](task-02-a-claude-write-confirmation-previews-its-edit.md) | done | 01 |

## Risks and tradeoffs

- The protocol's `ContentRef` carries `nonce`, which the local one did not; it is optional, so nothing ahpd builds changes.
- The preview reads the file on the daemon's disk, as the changes port's `observe` already does; a session running in a computer gets the same limitation the changeset has.

## Resume state

- **Done so far:** task 01 and task 02, both `implemented`, in one session on 2026-10-09. Every gate passes.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** `types/` imports no runtime value (`scripts/boundary.mjs`), so the re-export is `export type`. The backend half of task 02 is not in `session.ts`, which the claude/18 split turned into a composition of `session/*.ts`. The full suite rewrites `packages/sdk/test/fixtures/wire.jsonl` with this machine's paths, so that file shows as modified after a run.

## Final verification checklist

- [x] No hand-written `before?: { uri` shape left under `packages/*/src`.
- [x] A Claude `Edit` waiting for approval carries `edits` whose `after` reads back through `resourceRead`.
- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [x] `plans/index.md` updated.
