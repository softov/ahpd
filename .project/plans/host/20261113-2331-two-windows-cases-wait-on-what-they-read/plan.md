---
title: Two Windows cases wait on what they read
domain: host
status: planned
priority: medium
created: 2026-11-13
revalidated: 2026-11-13
requires: []
changes: []
creates: []
refs:
  - git://2bf97a6c1 - the commit of ahpd this plan was checked at, and the last one that holds `problems/a-dropped-client-case-loses-its-window-on-windows.md`
  - "[code://packages/sdk/test/host-tools.test.ts](../../../../packages/sdk/test/host-tools.test.ts) - \"fails a dropped client's streaming call once the daemon's window runs out, readied first\""
  - "[code://packages/sdk/test/changes-refresh.test.ts](../../../../packages/sdk/test/changes-refresh.test.ts) - `openInTree`, which polls `git worktree list` while the host writes the tree"
  - "[code://.project/problems/git-cases-time-out-on-windows.md](../../../problems/git-cases-time-out-on-windows.md) - the git cases, of which this plan fixes the third"
---

## Goal

Two cases that fail at random on Windows stop racing what they read.
The dropped-client case read a call's owner after a `settle` that outlasted the 50 ms window.
The worktree-row case read `git worktree list` while the host was still writing the tree, and git failed on it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- The dropped-client problem file names the cause: the window is 50 ms, and a `settle` on a Windows runner can take longer.
- The git-cases problem file names the third case's cause: `fatal: failed to read .git/worktrees/s/commondir`, from the test's own `git worktree list`.

### Runtime path

```
openInTree -> waitFor(git worktree list) -> git throws on a half-written tree -> the wait rejects
```

### Gaps

- The dropped-client window is shorter than a `settle` can take.
- `openInTree` takes a failed `git` read as a failure, not as a tree not there yet.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The window is 1000 ms, longer than any `settle`, so the owner is still read inside it | `(defaulted: it keeps the read after the close is handled, which a read before the settle would not)` | 01 |
| A failed `git worktree list` in the wait is a tree not there yet | The problem file's fix | 01 |
| The two other git cases wait for timings on a Windows runner | The problem file | - |

## Proposed architecture

- **Data flow** - unchanged.
- **Event flow** - unchanged.
- **State flow** - unchanged.
- **Layer responsibilities** - two test files.
- **Source-of-truth files** - the two test files.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The two cases wait on what they read](task-01-the-two-cases-wait-on-what-they-read.md) | implemented | - |

## Risks and tradeoffs

- The dropped-client case takes one second more.

## Resume state

- **Done so far:** task 01 implemented, 2026-11-13; see [implemented.md](implemented.md).
- **Next action:** review of the PR. The plan closes as `built` on Softov's word.
- **Open questions:** none.
- **Watch out for:** none.

## Final verification checklist

- [x] The dropped-client case passes twice in a row.
- [x] The worktree-row case passes.
