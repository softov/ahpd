---
title: A changes URI opens in a client that normalises it
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
  - decisions/an-ahp-edit-uri-carries-its-session-as-base64url.md
refs:
  - "[code://packages/sdk/src/changes.ts#L85-L95](../../../../packages/sdk/src/changes.ts#L85-L95) - `BEFORE`, `beforeUri` and `CAPTURED`"
  - "[code://packages/sdk/src/changes.ts#L242-L255](../../../../packages/sdk/src/changes.ts#L242-L255) - `kept` and `capturedUri`"
  - "[code://packages/sdk/src/changes.ts#L310-L320](../../../../packages/sdk/src/changes.ts#L310-L320) - `rowsOf`, where captured sides are minted and kept"
  - "[code://packages/sdk/src/changes.ts#L425](../../../../packages/sdk/src/changes.ts#L425) - a modified file's `before`, minted with `beforeUri`"
  - "[code://packages/sdk/src/changes.ts#L733](../../../../packages/sdk/src/changes.ts#L733) - a captured side kept under its minted text"
  - "[code://packages/sdk/src/changes.ts#L759-L779](../../../../packages/sdk/src/changes.ts#L759-L779) - `read`, which slices `ahp-git://` off and looks `ahp-edit:` up by exact text"
  - "[code://packages/sdk/src/changes.ts#L70-L76](../../../../packages/sdk/src/changes.ts#L70-L76) - `pathIn`, which reads an operation's `file://` target without decoding it"
  - "[code://packages/sdk/src/host.ts#L71-L73](../../../../packages/sdk/src/host.ts#L71-L73) - `ahp-root://` and `ahp-automations://`, other schemes ahpd mints"
  - git://6e4b2c4 - `gitChanges` and the `ahp-git:` URI
  - file:///github/externals/vscode - `src/vs/base/common/uri.ts` at the clone's HEAD, the `URI` class every VS Code request passes a URI through; the clone is sparse and has no working copy of it, so read it with `git -C /github/externals/vscode show HEAD:src/vs/base/common/uri.ts`, and its imports `charCode.ts`, `marshallingIds.ts`, `path.ts`, `platform.ts` and `process.ts` the same way
---

## Goal

Every side of a diff ahpd serves opens in VS Code as it does in a client that sends a URI back verbatim.
Today every modified file's `before` in the uncommitted changeset fails in VS Code with "nothing here serves ahp-git:", and a turn's captured sides fail whenever the session URI has a colon or a capital.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "ahp-git|ahp-edit" packages` - both are minted and read only in `packages/sdk/src/changes.ts`, and no test sends either back.
- `rg "[a-z]+-[a-z]+://" packages/*/src` - `ahp-root://` and `ahp-automations://` in `host.ts` are the other minted schemes.
- VS Code's `URI` class, compiled from the clone and run on the minted forms: `ahp-git:///github/ahpd/docs/AHP.md` comes back `ahp-git:/github/ahpd/docs/AHP.md`; `ahp-git:///github/ahpd/docs/a file #1.md` comes back `ahp-git:/github/ahpd/docs/a%20file%20#1.md`; `ahp-edit://cofold%3A%2FAbc-123/turn-1/before/...` comes back `ahp-edit://cofold:/abc-123/turn-1/before/...`; `ahp-git://head/github/ahpd/docs/AHP.md` comes back unchanged; `ahp-edit://turn/cofold%3A%2FAbc-123/t1/...` comes back `ahp-edit://turn/cofold%3A/Abc-123/t1/...`, because the path is decoded and re-encoded with `/` kept literal.

### Runtime path

```
changeset row (before/after content URI) -> client URI.parse + toString -> resource read -> ChangesetSource.read(uri) -> git show HEAD:<path> | kept side
```

### Gaps

- `read` slices a fixed `ahp-git://` prefix and so drops the first two characters of the path when the `//` is gone.
- `kept` is keyed by the minted text, which no normalising client sends back.
- No case sends a URI back in any form but the one minted.
- A new file has no `before`, which is why an untracked file opened while the modified ones did not.

## Decisions locked in

| Decision | Tasks |
| --- | --- |
| [A changes URI is parsed on read, and an ahp-edit URI carries its session as one base64url segment](../../../decisions/an-ahp-edit-uri-carries-its-session-as-base64url.md) | 01, 02 |

| What | Source | Task |
| --- | --- | --- |
| The fix is a host plan of its own. | Softov, 2026-09-27, asked where the fix goes: "New plan host/20". | - |
| Each scheme ahpd mints is checked through a client's normal form. | the decision's Consequences | 03 |
| The host takes `ahp-root://` and `ahp-root:` as the root channel, through one helper, as VS Code's `isAhpRootChannel` does (file:///github/externals/vscode, `src/vs/platform/agentHost/common/state/sessionState.ts` lines 760-777). | Softov, 2026-09-27, asked whether the host takes `ahp-root:`: "Accept both, as VS Code". | 03 |
| A task plan host/21 already fixed is pinned with a regression test. | Softov, 2026-09-27, asked what happens to a task host/21 already fixed: "Pin it with the test". | 04 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - ahp-git: is minted with an authority and read in any client's form](task-01-ahp-git-reads-any-form.md) | implemented | - |
| [02 - ahp-edit: keeps the session out of the authority and is read by its parts](task-02-ahp-edit-reads-by-its-parts.md) | implemented | 01 |
| [03 - Every URI ahpd mints opens after a client normalises it](task-03-every-minted-uri-round-trips.md) | implemented | 02 |
| [04 - A file target an operation names is read decoded](task-04-a-file-target-is-read-decoded.md) | implemented | 03 |

## Risks and tradeoffs

- Plan host/21 changes the same file and folds in the uncommitted draft in it; this plan starts after host/21's tasks are committed, and the line numbers in the refs are the working tree's with that draft.
- The round-trip cases carry a normaliser written to VS Code's rules; if VS Code changes them, the cases stay green while VS Code breaks.
  The by-hand check in task 03 is what catches that.

## Resume state

- **Done so far:** tasks 01 to 04 implemented, awaiting review.
  `ahp-git:` and `ahp-edit:` are minted in the new forms and read by their parsed parts, the host takes `ahp-root:` as the root channel through `isRootChannel`, every other minted URI is pinned through the normaliser, and task 04 is pinned by regression cases.
- **Next action:** review, then Softov's by-hand check in VS Code from task 03's Validation.
- **Open questions:** none.
- **Watch out for:** `packages/sdk/test/commit.test.ts` is host/21's; the cases here are in `packages/sdk/test/changes-uris.test.ts`.
  The normaliser in that file was ported from VS Code's `uri.ts`; check it against `uri.ts` again if VS Code changes it.
  The VS Code clone is sparse: read `uri.ts` with `git -C /github/externals/vscode show HEAD:src/vs/base/common/uri.ts`, not from its working tree.

## Final verification checklist

- [ ] A modified file's `before` opens in VS Code, and a turn's captured sides open in a session whose URI has a colon and a capital.
- [ ] A URI minted before the change still resolves when a client sends it back as it was given.
- [ ] `pnpm typecheck` and `pnpm test` green.
- [ ] `plans/index.md` updated.
