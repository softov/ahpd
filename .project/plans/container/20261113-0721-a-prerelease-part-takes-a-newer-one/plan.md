---
title: A part on a prerelease takes a newer prerelease
domain: container
status: planned
priority: medium
created: 2026-11-13
revalidated: 2026-11-13
refs:
  - git://a5b20cc4b - the last commit that holds the problem file this plan replaces, `problems/the-bump-calls-a-newer-prerelease-not-newer.md`
  - "[code://scripts/parts-bump.mjs#L166-L198](../../../../scripts/parts-bump.mjs#L166-L198) - `newerThan`, which refuses every prerelease"
  - "[code://scripts/parts-bump.mjs#L117-L149](../../../../scripts/parts-bump.mjs#L117-L149) - `orderOf`, semver's order of two prerelease tags, from plan container/20261113-0507"
  - "[code://scripts/parts-bump.mjs#L221-L235](../../../../scripts/parts-bump.mjs#L221-L235) - the skip lines that say \"not newer\" for a prerelease"
  - "[code://packages/computer/test/parts-bump.test.ts#L82-L95](../../../../packages/computer/test/parts-bump.test.ts#L82-L95) - the case that a part on a release is never moved to a prerelease"
  - "[code://packages/computer/images/versions.json#L125-L132](../../../../packages/computer/images/versions.json#L125-L132) - the dsh part, on `0.2.0-rc.2`"
---

## Goal

A part that is already on a prerelease, such as dsh, moves to a newer prerelease or to a release when its feed has one.
A part on a release still never moves to a prerelease, and the skip line says the feed has a prerelease instead of "not newer".

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "newerThan\(" scripts/parts-bump.mjs` - two callers, the npm part and the archive part.
- Run 43381150088 of `parts-bump.yml` - `skipped dsh: the feed has 0.2.2-rc.1, which is not newer than 0.2.0-rc.2`.

### Runtime path

```
parts-bump.yml -> bumpOf -> newerThan(feed, held) -> versions.json and the lock -> pull request
```

### Gaps

- `newerThan` answers `false` for every prerelease, so a part on a prerelease never moves to a newer one.
- The skip line reads that `false` as "not newer", which is false for a newer prerelease.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A part already on a prerelease moves to a newer prerelease, and a part on a release stays off them | Softov, 2026-11-13: "let a part that is already on a prerelease move to a newer prerelease, and keep a part on a release off them" | 01 |
| Two prerelease tags of the same core compare as semver orders them, with the tag code `orderOf` already has | (defaulted: one comparison of tags in the script) | 01 |
| A part on a release that is offered a prerelease is skipped with the line `the feed has <version>, a prerelease, and <id> is on a release` | (defaulted: the skip line says what is true) | 01 |
| The ahpd part keeps its own rule, the higher of `latest` and `next` | [code://scripts/parts-bump.mjs#L211-L218](../../../../scripts/parts-bump.mjs#L211-L218) | - |

## Proposed architecture

- **Data flow** - `bumpOf` asks `prereleaseRefused(next, held)` first, then `newerThan`. `newerThan` compares the cores as it does now. With equal cores and two tags, it compares the tags.
- **Layer responsibilities** - `scripts/parts-bump.mjs`: the rule · `docs/plugins/COMPUTERS.md`: the rule in *Bumps*.
- **Source-of-truth files** - [`code://scripts/parts-bump.mjs`](../../../../scripts/parts-bump.mjs)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A prerelease part moves to a newer one](task-01-a-prerelease-part-moves-on.md) | todo | - |

## Risks and tradeoffs

- A part on a prerelease follows each new candidate of its package, and each one is a new build. Only a part somebody put on a prerelease by hand does this.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-prerelease-part-moves-on.md](task-01-a-prerelease-part-moves-on.md).
- **Open questions:** none.
- **Watch out for:** a core that is not numbers, such as a feed that answers `latest`, still compares as a string in `newerThan`. Do not put the whole compare through `orderOf`, which reads each core segment as a number.

## Final verification checklist

- [ ] `npx vitest run packages/computer/test/parts-bump.test.ts` passes, with the new cases.
- [ ] `node scripts/parts-bump.mjs --dry-run` says `bumped dsh 0.2.0-rc.2 -> <the feed's prerelease>` while the feed has a newer one.
