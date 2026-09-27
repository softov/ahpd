---
title: A file or a folder is staged and unstaged from the session's changeset
domain: host
status: active
priority: high
created: 2026-09-27
revalidated: 2026-09-27
requires:
  - plans/host/21-commit-asks-and-takes-what-is-staged/plan.md
changes: []
creates: []
decisions:
  - decisions/a-commit-takes-the-index-when-anything-is-staged.md
refs:
  - "[code://packages/sdk/src/changes.ts#L107-L136](../../../../packages/sdk/src/changes.ts#L107-L136) - `settled` and `pathIn`, which judge a target where it resolves"
  - "[code://packages/sdk/src/changes.ts#L212-L238](../../../../packages/sdk/src/changes.ts#L212-L238) - `DISCARD`, `STAGE` and `UNSTAGE`"
  - "[code://packages/sdk/src/changes.ts#L928-L936](../../../../packages/sdk/src/changes.ts#L928-L936) - what the uncommitted scope offers"
  - "[code://packages/sdk/src/changes.ts#L995-L1006](../../../../packages/sdk/src/changes.ts#L995-L1006) - where `invoke` turns a target into a path"
  - file:///github/externals/agent-host-protocol/types/channels-changeset/state.ts - `ChangesetOperation`, whose own example ids include `"stage"`, and `ChangesetOperationScope.Resource`, "a single file within the changeset"
  - file:///github/externals/vscode - `src/vs/sessions/contrib/providers/agentHost/browser/changesActions.ts`: a resource-scoped operation is drawn as a button on every row
  - file:///github/ahpapp/src/changeset-ops.ts - ahpapp already draws resource-scoped operations
---

## Goal

A person stages and unstages from the session itself, in VS Code or in ahpapp, a file at a time or a whole folder, and Commit then takes exactly that.
Staging the session's own folder stages everything; nothing above that folder can be named.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "stage" /github/externals/vscode` under `src/vs/platform/agentHost` and `src/vs/sessions/contrib/providers/agentHost` - the reference host declares no stage operation; the protocol names `"stage"` as an example id.
- `rg -n "pathIn" packages/sdk/src/changes.ts` - every resource-scoped operation goes through it, and it neither decodes nor normalises the path.

### Runtime path

```
client invokeChangesetOperation stage|unstage { target.resource: file:///<dir>/<file or folder> }
  -> host (mid-turn refusal, as every operation) -> changes.ts invoke -> [new] contained path
  -> git add -A -- <path> | git restore --staged -- <path> -> refresh -> rows' _meta.staged + Commit's confirmation
```

### Gaps

- No operation stages or unstages.
- `pathIn` lets `..` through, so `discard` and `revert` can reach a file above the session's folder in the same repository.

## Decisions locked in

| Decision | Tasks |
| --- | --- |
| [The commit operation commits the index when anything is staged, and everything when nothing is](../../../decisions/a-commit-takes-the-index-when-anything-is-staged.md) | 02 |

| What | Source | Task |
| --- | --- | --- |
| Staging is ahpd operations on the uncommitted changeset, which ahpapp and VS Code draw, in a plan of its own. | Softov, 2026-09-27, asked where the stage and unstage work goes: "New plan host/22"; and asked again after a report said it was ahpapp work: "ahpd operations, host/22". | 02 |
| Two operations, `stage` and `unstage`, on every row, each harmless where it changes nothing. | Softov, 2026-09-27, asked how staging appears: "Two ops: stage and unstage". | 02 |
| The target is a file or a folder; the session's own folder stages everything; nothing above it can be named. | Softov, 2026-09-27, asked whether to add whole-changeset operations: "file and folder... so a folder in root is stage all... cannot go back more than root ../.. etc". | 01, 02 |
| The containment check is shared by every resource-scoped operation, `discard` and `revert` included. | the same answer, and [`code://packages/sdk/src/changes.ts#L101-L107`](../../../../packages/sdk/src/changes.ts#L101-L107) | 01 |
| Staging is refused mid-turn like every other operation. | (defaulted: the host refuses any operation while a turn runs; Softov may exempt staging) | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A target is judged where it resolves, and nothing above the session's folder is reached](task-01-a-target-stays-inside-the-folder.md) | implemented | - |
| [02 - A file or a folder is staged and unstaged](task-02-stage-and-unstage-a-file-or-folder.md) | implemented | 01 |
| [03 - The docs say how to stage](task-03-the-docs-say-how-to-stage.md) | implemented | 02 |

## Risks and tradeoffs

- VS Code draws both buttons on every row and cannot tell which applies; ahpapp can, from `_meta.staged` and `_meta.unstaged`.
- VS Code sends only row URIs, so a folder is staged from a client that sends one, such as ahpapp; ahpapp's folder button is ahpapp's own work.
- `changes.ts` is also changed by host/20, so the two land one after the other.

## Resume state

- **Done so far:** tasks 01 to 03 are implemented on 2026-09-27: a resource target is decoded, resolved and followed through symlinks before it is judged, `stage` and `unstage` are offered on the uncommitted changeset and move a file or a folder, and `docs/AHP.md` says how a person stages.
- **Next action:** Softov's review, then the manual check: in VS Code stage a row from the session and Commit, and in ahpapp stage a file and a folder.
- **Open questions:** none.
- **Watch out for:** a session's folder can be a subdirectory of its repository, so git itself accepts `../x`; the containment is this host's to enforce.
  A test stages in a scratch repository, never in the tree it runs from.

## Final verification checklist

- [ ] `stage` and `unstage` on a file, on a folder, and on the session's folder each move exactly those paths, and Commit's confirmation follows.
- [ ] A target with `..`, a percent-escaped `..`, or a symlink above the folder is refused by every resource-scoped operation.
- [ ] `pnpm typecheck`, `pnpm boundary` and `pnpm test` green.
- [ ] By hand, for Softov: in VS Code, stage a row from the session, then Commit, and only that file is committed; in ahpapp the same, and a folder.
- [ ] `plans/index.md` updated.
