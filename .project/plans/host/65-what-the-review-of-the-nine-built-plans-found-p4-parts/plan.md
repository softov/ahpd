---
title: An image holds what its tag says
domain: host
status: planned
priority: medium
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/65-what-the-review-of-the-nine-built-plans-found/plan.md
  - plans/container/05-an-agent-in-a-machine-p3-parts-are-built-from-one-versions-file/plan.md
refs:
  - "[code://packages/computer/src/parts.ts#L193-L229](../../../../packages/computer/src/parts.ts#L193-L229) - `pinnedOf`, `tagOf`, `hashOf`: versions and the ahpd source hash, nothing of the Dockerfile"
  - "[code://packages/computer/src/parts.ts#L311-L343](../../../../packages/computer/src/parts.ts#L311-L343) - `packedOf` and `ahpdSourceOf`"
  - "[code://packages/computer/src/parts.ts#L570](../../../../packages/computer/src/parts.ts#L570) - `dockerfileOf`, a part's Dockerfile"
  - "[code://packages/computer/src/parts.ts#L706-L721](../../../../packages/computer/src/parts.ts#L706-L721) - `ensurePart`, which builds only when the tag is missing"
  - "[code://packages/computer/src/parts.ts#L866](../../../../packages/computer/src/parts.ts#L866) - `joinedDockerfile`"
  - "[code://packages/computer/src/parts.ts#L902-L926](../../../../packages/computer/src/parts.ts#L902-L926) - `ensureJoined`"
  - "[code://packages/computer/src/parts.ts#L65-L68](../../../../packages/computer/src/parts.ts#L65-L68) - `EXACT` and `URL_SAFE`, which `readParts` checks"
  - "[code://scripts/parts-bump.mjs#L60-L166](../../../../scripts/parts-bump.mjs#L60-L166) - `newerThan`, `bumpOf` and the write"
  - "[code://packages/computer/test/computer-parts-build.test.ts](../../../../packages/computer/test/computer-parts-build.test.ts) - the build cases to extend"
---

## Goal

An image is reused only when it holds what its tag stands for: the joined image the parts actually in it, and a part's image the Dockerfile this code would write.
A failed pack is tried again, its scratch directory is removed, and a bump of the versions file proposes only what `readParts` would accept.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "hasImage" packages/computer/src/parts.ts` - both `ensurePart` and `ensureJoined` build only when the tag is missing.
- `rg -n "mkdtempSync|rmSync" packages/computer/src/parts.ts` - `packedOf` makes `ahpd-pack-*` and nothing removes it.

### Gaps

- `ensureJoined`'s tag is `hashOf(file, ahpd tag)`: a run where one part fails builds `ahpd-agents:<hash>` without it, and every later run reuses that image and answers `missing: []` once the part builds (finding C1).
- A part's tag carries its versions only, so a change to `dockerfileOf` or `joinedDockerfile` reuses images built by the old code (C2).
- `answered ??=` keeps a rejected pack until restart (C3).
- `parts-bump.mjs` writes versions and urls without `readParts`' checks, and `newerThan('1.3.0-rc.1', '1.2.0')` is true (C4).

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| The joined image's tag covers the ids of the parts inside it | the review, container/05 p3 | 01 |
| A part's and the joined image's tag cover a hash of the Dockerfile text that builds them | the review; `(defaulted: the text rather than a version constant, so nobody has to remember to move one)` | 02 |
| A bump proposes no prerelease, and checks each value the way `readParts` does before it writes | the review, container/05 p3 | 04 |
| npm parts are not reproducible: deferred | Softov, 2026-10-06 | [deferred.md](deferred.md) |

## Proposed architecture

- **Layer responsibilities** - computer: 01-03 (`parts.ts`) · scripts: 04.
- **Source-of-truth files** - [`code://packages/computer/src/parts.ts`](../../../../packages/computer/src/parts.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The joined image's tag covers the parts inside it](task-01-the-joined-images-tag-covers-the-parts-inside-it.md) | todo | - |
| [02 - A tag covers the Dockerfile that builds it](task-02-a-tag-covers-the-dockerfile-that-builds-it.md) | todo | 01 |
| [03 - A failed pack is tried again and leaves nothing](task-03-a-failed-pack-is-tried-again-and-leaves-nothing.md) | todo | - |
| [04 - A bump proposes only what readParts accepts](task-04-a-bump-proposes-only-what-readparts-accepts.md) | todo | - |

## Risks and tradeoffs

- Task 02 moves every tag once, so the first start after it rebuilds every part.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-joined-images-tag-covers-the-parts-inside-it.md](task-01-the-joined-images-tag-covers-the-parts-inside-it.md).
- **Open questions:** none.
- **Watch out for:** the build cases use a fake runtime; a real Docker run is by hand.

## Final verification checklist

- [ ] Each task's case fails on the code before it and passes after.
- [ ] `pnpm exec vitest run packages/computer/test/computer-parts*.test.ts` passes.
- [ ] `plans/index.md` updated.
