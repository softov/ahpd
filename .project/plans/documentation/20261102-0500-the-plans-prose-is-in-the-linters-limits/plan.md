---
title: The plans' prose is in the linter's limits
domain: documentation
status: planned
priority: low
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://9d1cc04e - the commit of ahpd this plan was checked at
  - "[code://.agents/skills/do-spec/scripts/lint-prose.mjs](../../../../.agents/skills/do-spec/scripts/lint-prose.mjs) - the linter: 20 words in a procedural section, 25 elsewhere, no passive in steps"
  - "[code://.agents/skills/do-spec/SKILL.md](../../../../.agents/skills/do-spec/SKILL.md) - the writing rules the linter checks"
---

## Goal

The plan files #183 merged pass the repository's prose linter.
Each long sentence is split where its clauses already part, and none of what a sentence says changes.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `git diff --name-only 39d1f22a 79294d20 -- .project/plans` - 72 plan files, the ones #183 merged.
- `node .agents/skills/do-spec/scripts/lint-prose.mjs` over them - 63 hits in 19 files: 62 long sentences and one passive step.

### Gaps

- 63 hits in the plans of the customization switch, the MCP start and stop, every-answered, cofold's answers and the state change said to every subscriber.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A descriptive sentence holds 25 words, a step or a validation line 20, and a step is active | lint-prose.mjs: `LIMIT_DESCRIPTIVE`, `LIMIT_PROCEDURAL`, `PASSIVE` | 01 |
| The scope is the files #183 merged | the review ledger: "about sixty sentences over its limit in 19 files" | 01 |

## Proposed architecture

- **Layer responsibilities** - plan files alone; no code or doc changes.
- **Source-of-truth files** - the 19 files the linter names.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - each hit is split where its clauses part](task-01-each-hit-is-split-where-its-clauses-part.md) | todo | - |

## Risks and tradeoffs

- The older plans of this repository hold thousands of hits; this plan leaves them as their authors wrote them.

## Resume state

- **Done so far:** nothing built.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** a split that drops a clause; read each line before and after.

## Final verification checklist

- [ ] The linter exits 0 over the 72 files #183 merged.
