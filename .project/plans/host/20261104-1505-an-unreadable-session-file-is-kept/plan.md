---
title: An unreadable session file is kept
domain: host
status: built
priority: medium
created: 2026-11-04
revalidated: 2026-11-04
refs:
  - git://0538977c - the commit of ahpd the facts were checked at, and the last that holds `problems/an-unreadable-session-file-is-overwritten.md`, which this plan replaces
  - "[code://packages/sdk/src/sessions/sessions.ts#L715-L737](../../../../packages/sdk/src/sessions/sessions.ts#L715-L737) - `load` logs and skips a file it cannot read, and leaves it where the next write replaces it"
  - "[code://packages/sdk/src/sessions/sessions.ts#L997](../../../../packages/sdk/src/sessions/sessions.ts#L997) - the old store file is renamed to `.migrated`: the pattern for a file set aside"
  - "[code://packages/sdk/src/utils/jsonfile.ts#L31-L38](../../../../packages/sdk/src/utils/jsonfile.ts#L31-L38) - `readJson` says `missing`, `unreadable` or `not-json`"
---

## Goal

A session file that this build cannot read is never written over.
Today load skips a file that is not JSON, or that a newer ahpd wrote.
The next write for its id then replaces it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "renameSync" packages/sdk/src/sessions` - the store already renames the old single file to `.migrated`.

### Runtime path

```
daemon start -> load -> readJson per file -> skipped file stays -> next write for the id -> writeJsonAtomic over it
```

### Gaps

- A skipped file keeps the name the next write uses.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Fix the seven open problems of the review now | Softov, 2026-11-04, "7 open problems, fix now" | 01 |
| A session file the store cannot read is moved aside, and the move is logged | Softov, 2026-11-04, chose "Move it aside" | 01 |
| The new name is `<file>.unreadable-<time>`, with the UTC time as `YYYYMMDDTHHMMSSZ`, in the same folder | (defaulted: a name that does not end in `.json` is not read at load, and a time keeps two moves of one id apart) | 01 |
| A file that is `unreadable`, `not-json`, or of an unknown version is moved; a `missing` file is not | (defaulted: each of the three is replaced by the next write today) | 01 |
| A move that fails is logged, and the file stays | (defaulted: the load reads the rest of the folder either way) | 01 |

## Proposed architecture

- **State flow** - `load` renames each file it cannot read, and the next write for the id makes a new file.
- **Layer responsibilities** - sdk: `load` in the file session store.
- **Source-of-truth files** - [`code://packages/sdk/src/sessions/sessions.ts`](../../../../packages/sdk/src/sessions/sessions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - an unreadable file is moved aside](task-01-an-unreadable-file-is-moved-aside.md) | done | - |

## Risks and tradeoffs

- A downgrade moves a newer ahpd's files aside. An upgrade back does not read them again until a person renames them.

## Resume state

- **Done so far:** task 01 is implemented on 2026-11-04.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** nothing open.

## Final verification checklist

- [x] `pnpm --filter @ahpd/sdk test` passes, run alone.
- [x] `pnpm typecheck` and `pnpm boundary` pass.
