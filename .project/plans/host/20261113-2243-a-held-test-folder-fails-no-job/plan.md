---
title: A held test folder fails no job, and the cofold truncation case says how its turn ended
domain: host
status: planned
priority: high
created: 2026-11-13
revalidated: 2026-11-13
requires: []
changes: []
creates: []
refs:
  - git://970d952e7 - the commit of ahpd this plan was checked at
  - "[code://tools/test-tmpdir.ts](../../../../tools/test-tmpdir.ts) - the run's temporary folder, removed by the global teardown"
  - "[code://packages/agent-cofold/test/agent-cofold-fork.test.ts#L522-L556](../../../../packages/agent-cofold/test/agent-cofold-fork.test.ts#L522-L556) - \"keeps the chat going when the store cannot truncate the conversation\""
  - "[code://.project/problems/a-cofold-truncation-case-ends-its-third-turn-without-completing.md](../../../problems/a-cofold-truncation-case-ends-its-third-turn-without-completing.md) - the cofold case's problem, which stays open"
---

## Goal

Two CI failures on main stop costing a run.
On 2026-11-13 at `1da0d0325`, run 43369212542, `windows (2/4)` failed after every test had passed: the global teardown threw `EBUSY` when it removed the run's folder.
The cofold truncation case failed on main twice on 2026-11-13, in runs 43379594402 and 43501399066, with no word on how its third turn ended.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- The failed CI runs on main since 2026-11-12, read on 2026-11-13. Every failed test case but the teardown has a problem file.
- `rg EBUSY .project/problems` - no problem names the teardown.
- The cofold case with a print of every turn action, run three times: `t2` gets no end action, because the truncation removes it. The chat's `activeTurn` is empty before `t3` is sent, also with the released stream held 300 ms. The failure did not come back.

### Runtime path

```
vitest ends -> globalSetup teardown -> rmSync(run) -> EBUSY on Windows -> the job fails with every test passed
```

### Gaps

- The teardown throws for a folder a process still holds.
- The cofold case asserts on the `turnComplete` list first, so a failure does not say whether `t3` was cancelled or failed, or with what error.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A folder the teardown cannot remove is a warning that names it, not a throw | `(defaulted: every test has run by then, and the line keeps a stray process seen)` | 01 |
| Only `EBUSY`, `EPERM` and `ENOTEMPTY` are warnings; any other error still throws | `(defaulted: those are the codes of a file still held open)` | 01 |
| The cofold case's first fix in its problem file, waiting for `t2`'s end, does not apply | The print: `t2` gets no end action | 02 |
| The cofold case asserts on `t3`'s end first, with an error's words | The problem file's second fix | 02 |

## Proposed architecture

- **Data flow** - unchanged.
- **Event flow** - unchanged.
- **State flow** - unchanged.
- **Layer responsibilities** - test tooling and one cofold case.
- **Source-of-truth files** - [`code://tools/test-tmpdir.ts`](../../../../tools/test-tmpdir.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The teardown warns for a held folder](task-01-the-teardown-warns-for-a-held-folder.md) | implemented | - |
| [02 - The cofold truncation case says how t3 ended](task-02-the-cofold-truncation-case-says-how-t3-ended.md) | implemented | - |

## Risks and tradeoffs

- A process a test leaves running no longer fails the Windows job. The warning names the folder, and the leftover folder is in the runner's temporary folder.
- Task 02 does not fix the cofold case. Its next failure says how `t3` ended, and the problem file stays open.

## Resume state

- **Done so far:** tasks 01 and 02 implemented, 2026-11-13; see [implemented.md](implemented.md).
- **Next action:** Softov reviews the PR. The plan closes as `built` on his word.
- **Open questions:** none.
- **Watch out for:** the cofold problem file names a fix that does not apply. It is updated in this plan.

## Final verification checklist

- [x] The teardown removes the run's folder, and warns for a held one.
- [x] The cofold file passes, and its case asserts on `t3`'s end first.
