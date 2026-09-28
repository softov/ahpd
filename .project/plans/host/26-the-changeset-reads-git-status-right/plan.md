---
title: The session's changes read git's status right, from any folder
domain: host
status: planned
priority: high
created: 2026-09-28
revalidated: 2026-09-28
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/changes.ts#L536-L620](../../../../packages/sdk/src/changes.ts#L536-L620) - `look()`, the `uncommitted` rows from `git status --porcelain=v1 -z`"
  - "[code://packages/sdk/src/changes.ts#L584](../../../../packages/sdk/src/changes.ts#L584) - a rename's source record is consumed only when the index column is `R` or `C`"
  - "[code://packages/sdk/src/changes.ts#L591](../../../../packages/sdk/src/changes.ts#L591) - the row id joins the session folder to a path git gives from the repository root"
  - "[code://packages/sdk/src/changes.ts#L484-L506](../../../../packages/sdk/src/changes.ts#L484-L506) - `rowsOf()`, the `session` rows from the captured sides"
  - "[code://packages/sdk/src/changes.ts#L36-L44](../../../../packages/sdk/src/changes.ts#L36-L44) - `counted()`, which counts a trailing newline as a line"
  - "[code://packages/sdk/src/changes.ts#L1124-L1141](../../../../packages/sdk/src/changes.ts#L1124-L1141) - `stage` and `unstage`, which take the row's path"
  - "[code://packages/agent-claude/src/session.ts#L1573-L1577](../../../../packages/agent-claude/src/session.ts#L1573-L1577) - claude's `before` capture for an edit tool"
  - "[code://packages/agent-claude/src/session.ts#L1701-L1707](../../../../packages/agent-claude/src/session.ts#L1701-L1707) - claude's `after`, only when the call's part is known"
  - "[code://packages/sdk/test/commit.test.ts](../../../../packages/sdk/test/commit.test.ts) - the staging cases, which check porcelain text and never a row's sides"
---

## Goal

A file a session created, edited and staged is listed as added, in the session's changes and in the uncommitted ones, and every row is right when the session's folder is a subfolder of its repository or git reports a rename in the working tree.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- Replayed create, edit, `git add -A -- <path>` against the built SDK in scratch repositories: both scopes list an addition before and after staging, so the reported `D` is not reproduced by that path.
- `git status --porcelain=v1 -z` gives ` R new\0old\0` for a working-tree rename (after `git add -N`); `look()` reads `old` as a row with the status of its first two letters, which is a `D` when the path starts with `D`.
- Under `git -C sub`, porcelain paths are relative to the repository root; the row id became `.../sub/sub/new.txt`, and `unstage` on it failed with `pathspec 'sub/new.txt' did not match`.
- Clients decide the letter from the row's sides: no `before` is `A`, no `after` is `D`.

### Runtime path

```
Claude Write, Edit -> onFileEdit before/after -> changes.observe -> session rows (rowsOf)
Claude Bash `git add` -> watch -> refreshWatched -> look() -> uncommitted rows -> client letter from before/after
```

### Gaps

- The reported `D` (Claude wrote a file, edited it, and staged it with `git add` through Bash; Softov saw `D` in `/changes`) has no known cause.
- A working-tree rename makes a fake row.
- A session in a subfolder has wrong row ids, content URIs and line counts, and staging or unstaging from its rows fails.
- `counted()` counts a trailing newline as one more line.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| The `D` is reproduced the way Softov met it before it is fixed: Claude writes, edits, and runs `git add` through Bash. | Softov, 2026-09-28: "claude running on ahpd... staged using bash git add". | 01 |
| A rename or copy in either column consumes its source record. | git's porcelain v1 format | 02 |
| Row paths are resolved against the repository root, and only rows under the session folder are listed. | git's porcelain paths are root-relative | 03 |
| A trailing newline is not a line. | the count a person expects | 04 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A file Claude created, edited and staged through Bash is listed as added](task-01-a-staged-new-file-is-listed-as-added.md) | todo | - |
| [02 - A rename in the working tree is one row](task-02-a-working-tree-rename-is-one-row.md) | todo | - |
| [03 - A session in a subfolder lists its rows by their real paths](task-03-a-subfolder-session-has-real-paths.md) | todo | - |
| [04 - A trailing newline is not counted as a line](task-04-a-trailing-newline-is-not-a-line.md) | todo | - |

## Risks and tradeoffs

- Task 01 may find the cause outside ahpd, in the client; if so it records where and stops, and the fix is asked of Softov.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-staged-new-file-is-listed-as-added.md](task-01-a-staged-new-file-is-listed-as-added.md).
- **Open questions:** none.
- **Watch out for:** the `session` scope reads no git at all; a `D` there means a `before` was captured and no `after` ever was.

## Final verification checklist

- [ ] A Claude session that writes, edits and `git add`s a file lists it as added in both scopes, in ahpapp.
- [ ] A working-tree rename is one row under its new name.
- [ ] A session in a subfolder stages and unstages from its rows.
- [ ] `pnpm typecheck`, `pnpm boundary`, `pnpm test` green; `plans/index.md` updated.
