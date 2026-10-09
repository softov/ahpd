---
title: VS Code opens the uncommitted changes first, so Commit shows
domain: host
status: built
priority: medium
created: 2026-10-09
revalidated: 2026-10-09
refs:
  - "[code://packages/sdk/src/changes.ts#L845-L890](../../../../packages/sdk/src/changes.ts#L845-L890) - `scopes()`, which lists `session` before `uncommitted` once a session has turns"
  - "[code://packages/sdk/src/changes.ts#L1027-L1052](../../../../packages/sdk/src/changes.ts#L1027-L1052) - `operations()`, which offers `commit` on `uncommitted` only"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/common/changesetUri.ts#L176-L181 - `selectDefaultChangeset`, a `branch` entry or else the first in the catalogue
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/sessions/contrib/changes/browser/changesActions.ts#L478-L505 - the Commit button reads the selected changeset's `commit` operation
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentHostCommitOperationProvider.ts#L37-L56 - VS Code's own host offers `commit` on the uncommitted changeset only
---

## Goal

A session opened in VS Code shows the Commit button when its working tree has changes.
VS Code opens the first changeset ahpd lists, and today that is "This Session", which offers Create PR and no Commit.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "selectDefaultChangeset" src/vs` in VS Code - the Changes view and the input pills both pick a `branch` entry, else the first.
- `rg -n "id: 'session'" packages/sdk/src/changes.ts` - `session` is put first, with a comment that says a conversation's changes belong beside it.

### Gaps

- ahpd lists no `branch` changeset, so VS Code opens `session`, and `commit` is not offered there.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| `uncommitted` comes first in the catalogue, then `session`, then the templates | Softov, 2026-10-09, asked "VS Code opens the first changeset ahpd lists, and today that is \"This Session\", which offers Create PR but not Commit. What should ahpd change?": "List uncommitted first" | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The catalogue lists the working tree first](task-01-the-catalogue-lists-the-working-tree-first.md) | done | - |

## Risks and tradeoffs

- A client now opens the working tree, which can hold changes from outside the conversation. "This Session" stays in the picker.

## Resume state

- **Done so far:** task 01 implemented: `scopes()` lists `uncommitted` before `session`, and the order case in `packages/sdk/test/changes-uris.test.ts` holds it. Gates pass, nothing committed.
- **Next action:** none. The plan is built; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** a directory with no git tree has no `uncommitted` entry, so `session` is first there and nothing changes.

## Final verification checklist

- [x] A session with turns and a dirty tree lists `uncommitted` first, and that entry offers `commit`.
- [x] `pnpm test` passes.
- [x] `plans/index.md` updated.
