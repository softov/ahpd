---
title: A parts file names itself in its errors
domain: container
status: planned
priority: low
created: 2026-11-11
revalidated: 2026-11-11
requires: []
changes: []
creates: []
refs:
  - git://89cfcd7ad - the commit of ahpd this plan was checked at, and the last one that holds `problems/a-parts-file-read-from-elsewhere-reports-the-shipped-one.md`
  - "[code://packages/computer/src/parts.ts#L133](../../../../packages/computer/src/parts.ts#L133) - `said`, which names `versionsPath()` in every error"
  - "[code://packages/computer/src/parts.ts#L144-L156](../../../../packages/computer/src/parts.ts#L144-L156) - `entryOf` and its `exact`, which name `versionsPath()` too"
  - "[code://packages/computer/src/parts.ts#L243-L262](../../../../packages/computer/src/parts.ts#L243-L262) - `readParts`, whose own errors name the path it read"
  - "[code://packages/computer/test/computer-parts.test.ts#L129-L136](../../../../packages/computer/test/computer-parts.test.ts#L129-L136) - cases that read a temp file and expect the shipped path"
---

## Goal

An error about an entry of a parts file names the file that was read.
Today `readParts(path)` names `path` in its own errors, and the shipped `versions.json` in every error about an entry.
A bump over a copy, or a test over a fixture, is then told that the shipped file is wrong.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "said\(|versionsPath\(\)" packages/computer/src/parts.ts` - `said` and `exact` in `entryOf` name `versionsPath()`. The other uses read the shipped file itself.
- `rg "versionsPath\(\)" packages/computer/test/computer-parts.test.ts` - two cases expect the shipped path for a temp file.

### Runtime path

```
readParts(path) -> entryOf(value, where) -> said(problem) -> Error("<versionsPath()>: <problem>")
```

### Gaps

- `entryOf` does not know the path it reads from.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `entryOf` takes the path, and its errors name it | the problem's first candidate, "thread the path into `entryOf` and `said`" | 01 |
| The uses of `versionsPath()` outside `entryOf` stay, because they read the shipped file | [code://packages/computer/src/parts.ts#L338](../../../../packages/computer/src/parts.ts#L338) | 01 |

## Proposed architecture

- **Data flow** - `readParts` passes its `path` to `entryOf`, which names it in each error.
- **Layer responsibilities** - computer only.
- **Source-of-truth files** - [`code://packages/computer/src/parts.ts`](../../../../packages/computer/src/parts.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An entry error names its file](task-01-an-entry-error-names-its-file.md) | todo | - |

## Risks and tradeoffs

- None: the shipped file still names itself, because `readParts` reads it by default.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-an-entry-error-names-its-file.md](task-01-an-entry-error-names-its-file.md).
- **Open questions:** none.
- **Watch out for:** `entryOf` in `gitdir.ts` is another function of the same name.

## Final verification checklist

- [ ] An entry error from a temp file names the temp file.
- [ ] `pnpm typecheck` and the computer suite pass.
