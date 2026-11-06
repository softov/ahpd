---
title: A rules walk visits a folder once
domain: claude
status: planned
priority: high
created: 2026-11-04
revalidated: 2026-11-04
refs:
  - git://0538977c - the commit of ahpd the facts were checked at, and the last that holds `problems/a-symlink-loop-in-claude-rules-hangs-the-daemon.md`, which this plan replaces
  - "[code://packages/agent-claude/src/session/disk.ts#L202-L224](../../../../packages/agent-claude/src/session/disk.ts#L202-L224) - `markdownUnder`, which keeps the real path of each folder it walked"
  - "[code://packages/agent-claude/src/session/disk.ts#L48-L52](../../../../packages/agent-claude/src/session/disk.ts#L48-L52) - `RULE_DEPTH` is 32, and `RULE_MOST` counts only `.md` files"
---

## Goal

A repository with a symlink loop in `.claude/rules` cannot stop the daemon.
Today two links to `.` make about 2^33 synchronous `readdir` calls on the daemon's thread, for every user.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "markdownUnder" packages/agent-claude/src` - one walk, used by `rulesIn`.

### Runtime path

```
session opens -> rulesIn -> markdownUnder -> statSync and readdir per folder
```

### Gaps

- The walk keeps no set of the folders it saw.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Fix the seven open problems of the review now | Softov, 2026-11-04, "7 open problems, fix now" | 01 |
| The walk keeps the real path of each folder it walks, and skips one it saw before | (defaulted: a linked folder that is not a loop still gives its rules, which `lstatSync` would drop) | 01 |

## Proposed architecture

- **Layer responsibilities** - agent-claude: `markdownUnder` holds a set of real paths for one walk.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session/disk.ts`](../../../../packages/agent-claude/src/session/disk.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a folder is walked once](task-01-a-folder-is-walked-once.md) | implemented | - |

## Risks and tradeoffs

- A `realpathSync` per folder costs one more call per folder. A rules tree is small.

## Resume state

- **Done so far:** task 01 is implemented on 2026-11-04. Without the change, the loop case fails in 0.3 s.
- **Next action:** review.
- **Open questions:** none.
- **Watch out for:** nothing open.

## Final verification checklist

- [x] `pnpm --filter @ahpd/agent-claude test` passes, run alone.
- [x] `pnpm typecheck` and `pnpm boundary` pass.
