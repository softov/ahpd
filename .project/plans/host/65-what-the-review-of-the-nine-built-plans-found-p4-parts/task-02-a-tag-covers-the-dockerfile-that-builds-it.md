---
title: A tag covers the Dockerfile that builds it
status: done
depends: [task-01-the-joined-images-tag-covers-the-parts-inside-it.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/parts.ts#L193-L247](../../../../packages/computer/src/parts.ts#L193-L247) - `pinnedOf`, `tagOf` and `hashOf`"
  - "[code://packages/computer/src/parts.ts#L385-L392](../../../../packages/computer/src/parts.ts#L385-L392) - `nodeTag`, which the Dockerfile copies the node part from"
  - "[code://packages/computer/src/parts.ts#L596](../../../../packages/computer/src/parts.ts#L596) - `dockerfileOf`"
  - "[code://packages/computer/src/parts.ts#L902](../../../../packages/computer/src/parts.ts#L902) - `joinedDockerfile`"
---

## Objective

A part's tag and the joined image's tag change when the Dockerfile text that builds them changes, so an upgrade of ahpd that changes how an image is written builds it again.

## Files

- `UPDATE: packages/computer/src/parts.ts:197-247` - `tagOf` takes the Dockerfile text and appends a short hash of it, and `hashOf` hashes the joined Dockerfile beside the ids of the parts held.
- `UPDATE: packages/computer/src/parts.ts:385-392` - `nodeTag`, which writes the `COPY --from` every npm-built part carries.
- `UPDATE: packages/computer/src/parts.ts:732-751,938-966` - `ensurePart` writes the Dockerfile once, for the tag and for the build; `ensureJoined` does the same for the joined image.
- `UPDATE: packages/computer/test/computer-parts-build.test.ts` - the case below.
- `UPDATE: packages/computer/test/computer-parts.test.ts`, `packages/computer/test/computer-needs.test.ts` - the tags and labels they spell are derived now.
- `UPDATE: docs/COMPUTER.md:600` - the paragraph saying the tag is the version alone.

## Steps

1. Failing case first: build a part, then change what its Dockerfile says, and ask again. Today no build happens; after, one does. The seam is the file's own text rather than a wrapped `dockerfileOf`: a part given an extra `bin` entry writes a different Dockerfile, which is the shape an upgrade that changed `dockerfileOf` leaves behind.
2. The fill volume named from the tag moves with it; the mount cases build `MadePart` by hand and still pass.

## Validation

- The case fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/computer/test/computer-parts*.test.ts`.

## Resume

Implemented. `tagOf` gained a third parameter, the Dockerfile text, and appends `-<12 hex of sha256 of that text>` to the tag; `fileHashOf` is the hash and `dockerfileOf` is still the only writer of it. `ensurePart` writes the text once and uses it for both the tag and `contextOf`, and `ensureJoined` computes `joinedDockerfile(held, tags)` before the tag instead of inside the build, so the joined image moves with the text that names every part's tag. `hashOf` takes the joined Dockerfile as a fourth argument - after the held ids task 01 added - and hashes it.

Two consequences the task did not name, both in the same change. `nodeTag` writes the `COPY --from` every npm-built part carries, and it read `tagOf(node)` while `ensurePart` builds the node image at `tagOf(node, undefined, dockerfileOf(node))`, so it now derives the tag the same way - a mismatch is a stage Docker cannot resolve. And `MadePart.version` is what the tag says after its name, which is what `partsLabel` writes and `volumeOf` names a volume by, so both now carry the Dockerfile's hash; the label is read by id everywhere (`partsSaid`), and the volume moving with the tag is step 2's own expectation.

The failing case was seen first: `expected 2, received 1`, the second run building nothing. Fallout the change caused and the tests were updated for: the literals in `computer-parts-build.test.ts` (`tagFor`), `computer-parts.test.ts` (`nodeTag`, and the tag cases now assert both the bare tag and the Dockerfile-bearing one), and `computer-needs.test.ts` (`versionOf`, which replaces `pinnedOf` for what a tag says after its name). Gates: `npx tsc -b` clean, `npm run boundary` clean, `npx vitest run packages/computer` 19 files and 331 tests passed. Two cases in `computer-disposable.test.ts` and `computer-uptime.test.ts` failed once under the whole-package load and passed alone and on the next full run; neither reads a part tag.

`docs/COMPUTER.md:600` said the tag is the version and nothing else, which is what this task changes, so the sentence now names the Dockerfile's hash too.
