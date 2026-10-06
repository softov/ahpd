---
title: An image holds what its tag says
domain: host
status: built
priority: medium
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/65-what-the-review-of-the-nine-built-plans-found/plan.md
  - plans/container/05-an-agent-in-a-machine-p3-parts-are-built-from-one-versions-file/plan.md
refs:
  - "[code://packages/computer/src/parts.ts#L193-L247](../../../../packages/computer/src/parts.ts#L193-L247) - `pinnedOf`, `tagOf` and `hashOf`: versions, the ahpd source hash, the parts held and the Dockerfile text"
  - "[code://packages/computer/src/parts.ts#L311-L343](../../../../packages/computer/src/parts.ts#L311-L343) - `packedOf` and `ahpdSourceOf`"
  - "[code://packages/computer/src/parts.ts#L570](../../../../packages/computer/src/parts.ts#L570) - `dockerfileOf`, a part's Dockerfile"
  - "[code://packages/computer/src/parts.ts#L706-L721](../../../../packages/computer/src/parts.ts#L706-L721) - `ensurePart`, which builds only when the tag is missing"
  - "[code://packages/computer/src/parts.ts#L866](../../../../packages/computer/src/parts.ts#L866) - `joinedDockerfile`"
  - "[code://packages/computer/src/parts.ts#L902-L926](../../../../packages/computer/src/parts.ts#L902-L926) - `ensureJoined`"
  - "[code://packages/computer/src/parts.ts#L65-L68](../../../../packages/computer/src/parts.ts#L65-L68) - `EXACT` and `URL_SAFE`, which `readParts` checks"
  - "[code://scripts/parts-bump.mjs#L30-L39](../../../../scripts/parts-bump.mjs#L30-L39) - `EXACT`, `URL_SAFE` and `SHA256`, mirrored from `parts.ts`"
  - "[code://scripts/parts-bump.mjs#L74-L138](../../../../scripts/parts-bump.mjs#L74-L138) - `newerThan`, `bumpOf` and the values each checks before proposing them"
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
| `pnpm pack` prints an absolute tarball path and `packOf` joined it onto the pack directory, so the read was `ENOENT` on a checkout; it is resolved, not joined | found building host/65 p4 task 03, 2026-10-06 | 03 |
| npm parts are not reproducible: deferred | Softov, 2026-10-06 | [deferred.md](deferred.md) |

## Proposed architecture

- **Layer responsibilities** - computer: 01-03 (`parts.ts`) · scripts: 04.
- **Source-of-truth files** - [`code://packages/computer/src/parts.ts`](../../../../packages/computer/src/parts.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The joined image's tag covers the parts inside it](task-01-the-joined-images-tag-covers-the-parts-inside-it.md) | done | - |
| [02 - A tag covers the Dockerfile that builds it](task-02-a-tag-covers-the-dockerfile-that-builds-it.md) | done | 01 |
| [03 - A failed pack is tried again and leaves nothing](task-03-a-failed-pack-is-tried-again-and-leaves-nothing.md) | done | - |
| [04 - A bump proposes only what readParts accepts](task-04-a-bump-proposes-only-what-readparts-accepts.md) | done | - |

## Risks and tradeoffs

- Task 02 moves every tag once, so the first start after it rebuilds every part.

## Resume state

- **Done so far:** all four tasks, each with its case failing first and passing after - [implemented.md](implemented.md).
- **Next action:** review. Nothing here is waiting on a decision.
- **Open questions:** none. The one task 03 was blocked on - whether it takes the `packOf` read too - was answered by Softov on 2026-10-06 with yes, and it is a row in the second table.
- **Watch out for:** the build cases use a fake runtime; a real Docker run is by hand. Every part tag and every label now carries the Dockerfile's short hash, so a case that spells a tag has to derive it - `tagFor` in `computer-parts-build.test.ts`, `nodeTag` in `computer-parts.test.ts`, `versionOf` in `computer-needs.test.ts`. `parts-bump.test.ts` runs a copy of the script in a directory of its own, so its cases write a parts file of their own rather than the shipped one. A problem was met and filed: `readParts` messages name the shipped file whatever path was read.

## Final verification checklist

- [ ] Each task's case fails on the code before it and passes after.
- [ ] `pnpm exec vitest run packages/computer/test/computer-parts*.test.ts` passes.
- [ ] `plans/index.md` updated.
