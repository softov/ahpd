---
title: An image holds what its tag says - implemented
date: 2026-10-06
refs:
  - git://0cdbb95
  - "[code://packages/computer/src/parts.ts#L193-L247](../../../../packages/computer/src/parts.ts#L193-L247) - `pinnedOf`, `tagOf`, `fileHashOf` and `hashOf`"
  - "[code://packages/computer/src/parts.ts#L385-L392](../../../../packages/computer/src/parts.ts#L385-L392) - `nodeTag`, which writes the `COPY --from` every npm-built part carries"
  - "[code://packages/computer/src/parts.ts#L320-L396](../../../../packages/computer/src/parts.ts#L320-L396) - `packOf`, `packedOf` and `ahpdSourceOf`, which task 03 fixed"
  - "[code://packages/computer/src/parts.ts#L706-L751](../../../../packages/computer/src/parts.ts#L706-L751) - `ensurePart`, which writes the Dockerfile once for its tag and for its build"
  - "[code://packages/computer/src/parts.ts#L902-L966](../../../../packages/computer/src/parts.ts#L902-L966) - `joinedDockerfile` and `ensureJoined`"
  - "[code://scripts/parts-bump.mjs#L30-L39](../../../../scripts/parts-bump.mjs#L30-L39) - `EXACT`, `URL_SAFE` and `SHA256`, mirrored from `parts.ts`"
  - "[code://scripts/parts-bump.mjs#L74-L138](../../../../scripts/parts-bump.mjs#L74-L138) - `newerThan` and `bumpOf`, where every value is checked before it is proposed"
  - "[code://packages/computer/test/computer-parts-build.test.ts](../../../../packages/computer/test/computer-parts-build.test.ts) - the build cases for tasks 01, 02 and 03"
  - "[code://packages/computer/test/parts-bump.test.ts](../../../../packages/computer/test/parts-bump.test.ts) - the four cases for task 04"
  - "[code://docs/COMPUTER.md#L600](../../../../docs/COMPUTER.md#L600) - the paragraph that said the tag is the version alone"
---

An image is reused only when it stands for what its tag says. The joined image's tag now folds in the ids of the parts it actually holds, so an `ahpd-agents` image built while one part failed is not the image the next run finds when that part builds. A part's tag and the joined tag carry a short hash of the Dockerfile text that writes them, so an ahpd upgrade that changes how an image is written is a different image at the same versions. And the bump of the versions file no longer proposes a prerelease, and checks every version, url and sum the way `readParts` does before it writes any of them, so a value the feed has that the file cannot hold is a part skipped by name rather than a file the next start refuses whole.
A checkout can now build its own ahpd part at all: the pack is read at the path `pnpm pack` printed rather than inside the directory it was asked to write into, a pack that failed is asked again by the next build, and the scratch directory a pack used is gone once its bytes are read.

## What was built

- [`code://packages/computer/src/parts.ts`](../../../../packages/computer/src/parts.ts) - `hashOf` takes the ids of the parts the image holds and hashes them, sorted, beside the file's bytes and the ahpd part's tag; `ensureJoined` passes `held.map((part) => part.id)`. `fileHashOf` is a new short hash of a Dockerfile's text, `tagOf` appends it when it is given one, and `hashOf` takes the joined Dockerfile as a fourth argument and hashes it. `ensurePart` writes its Dockerfile once and uses it for both the tag and `contextOf`; `ensureJoined` computes `joinedDockerfile(held, tags)` before the tag rather than inside the build. `nodeTag` derives the node part's tag the same way `ensurePart` builds it, so the `COPY --from` names a tag that exists.
- [`code://scripts/parts-bump.mjs`](../../../../scripts/parts-bump.mjs) - `newerThan` refuses any candidate carrying a prerelease tag before it compares numbers. `bumpOf` checks the version with `EXACT`, each archive url with `URL_SAFE` before it is fetched or written, and each sum with `SHA256`; the patterns are mirrored from `parts.ts` with a comment naming it, because the bump workflow installs nothing and builds nothing.
- [`code://packages/computer/test/computer-parts-build.test.ts`](../../../../packages/computer/test/computer-parts-build.test.ts) - the case for each of tasks 01 and 02, plus `tagFor`, which derives a part's tag, since every literal spelled in the file moved.
- [`code://packages/computer/src/parts.ts`](../../../../packages/computer/src/parts.ts) - `packOf` reads the tarball at `resolve(into, file)`, which is the absolute path `pnpm pack` prints and a relative one read against the pack destination; `packedOf` removes its scratch directory in a `finally`; `ahpdSourceOf` keeps the pack's promise in `answered` and clears it in a `catch` when it is still that same promise, so a refusal is answered once and not remembered.
- [`code://packages/computer/test/computer-parts-build.test.ts`](../../../../packages/computer/test/computer-parts-build.test.ts) - three cases over a `pnpm` of the test's own, first on `PATH`: a shell script that writes a tarball into the `--pack-destination` it is given and prints its absolute path as its last line, with a switch that makes it refuse once.
- [`code://packages/computer/test/parts-bump.test.ts`](../../../../packages/computer/test/parts-bump.test.ts) - four cases over a copy of the script in a directory of its own, so a case writes a parts file of its own rather than the shipped one.
- [`code://docs/COMPUTER.md`](../../../../docs/COMPUTER.md) - the paragraph that said a tag is the versions and nothing else now names the Dockerfile's hash.

## Verified

- Task 01's case failed first with the second `ensureJoined` answering the first run's tag, building nothing and recording a Dockerfile without the part: `expected 'FROM debian:bookworm-slim\nRUN apt-ge…' to contain 'COPY --from=ahpd-part/goose:1.53.0 /o…'`.
- Task 02's case failed first with `expected 2, received 1`, the second run building nothing after the Dockerfile text moved.
- Task 04's three cases failed first on the script as it stood: `bumped goose 1.53.0 -> 1.54.0-rc.1`, `bumped goose 1.53.0 -> 1.54.0` over an `http://` archive, and a written file whose goose was at `latest`. The third was checked against the pre-fix script directly, by running `git show HEAD:scripts/parts-bump.mjs` over the same fixture, because that case writes rather than prints.
- Task 03's three cases failed first against the scripted `pnpm`: the read with `ENOENT: no such file or directory, open '<tmp>/ahpd-pack-GC8IkK/<tmp>/ahpd-pack-GC8IkK/packed-2705759.tgz'`, the retry with the second `ahpdSourceOf()` being handed `pnpm pack could not pack @ahpd/server, which the release workflow runs after pnpm build`, and the leftovers with `expected [ 'ahpd-pack-EfB7hd' ] to deeply equal []`.
- `npx tsc -b` clean, `npm run boundary` clean, `npx vitest run packages/computer` - 20 files, 338 tests pass. Two cases in `computer-disposable.test.ts` and `computer-uptime.test.ts` failed once under the whole-package load and passed alone and on the next full run; neither reads a part tag.
- The work is uncommitted on `0cdbb95`.

## Departures from the plan

- Task 02 named the tag change and nothing else. Two consequences came with it, both in the same change: `nodeTag` wrote the un-hashed tag while `ensurePart` built the hashed one, which is a stage Docker could not resolve, and `MadePart.version` - what `partsLabel` writes and `volumeOf` names a volume by - now carries the Dockerfile's hash. The label is read by id everywhere, and the volume moving with the tag is what task 02's step 2 expects.
- Task 04's step 2 preferred importing `EXACT`, `URL_SAFE` and the sum check from `parts.ts` over a second copy. `parts-bump.yml` runs the script with no install and no build, so there is no built module to import and no `readParts` to run on the result; the patterns are mirrored with a comment naming their source, and the cases write a file and read it back with the real `readParts`, which is what holds the two copies together.
- Task 04's cases are three plus one. The third writes rather than running `--dry-run`, because a case that only prints cannot show that the file reads; the fourth, which is not in the task, holds a run that does move to the same read-back, so no case can pass with the script writing nothing at all.
- Task 03 was blocked on a question the review had not asked - whether it takes the `packOf` read as well as the retry and the scratch directory. Softov answered on 2026-10-06 that it does, so the row is in the plan's table and the read is the task's first case. The task was already built once with the read broken: nothing could reach its second case, because a checkout's `ahpdSourceOf()` rejected before the retry mattered.
- Task 03's cases need a `pnpm` of the test's own on `PATH`, because a real pack needs `pnpm build` - which CI runs after `pnpm test` - to make `prepack`'s `tsc -p .` resolve. The fake writes a tarball and prints its absolute path, which is the contract under test; it does not check that `pnpm pack` really prints an absolute path, which is what the reproduction in the task file shows and what the row records.

## Review fixes

- `ensureJoined` asked `ahpdSourceOf()` for its hash whenever the file named an ahpd part, whether or not that part had built - and a pack that failed is not remembered, so on a checkout with no `pnpm build` the second ask threw the same `pnpm pack could not pack @ahpd/server` out of the whole join. No machine at all was made, where `missing` is there so that every machine not needing that part still is. The hash is asked for only when the ahpd part is among the parts that built; an ahpd part in the image has already answered it through its own build, and this reads the remembered answer. The case is `answers the ahpd part as missing when its own pack fails, rather than throwing out of the join`, and it failed first with `pnpm pack could not pack @ahpd/server` thrown from `parts.ts:336` through `hashOf` and `ensureJoined`.
- `hashOf` threw for a file naming an ahpd part when it was given no source hash, which the fix above reaches: `tagOf` refuses to write a tag without one, and rightly, since that is the whole point of the ahpd tag. It folds such a part in as `<id> unbuilt` instead, which is a term `tagOf` cannot produce, so an image made without the part still cannot hash the same as one made with it. `tagOf`'s own refusal is unchanged and still asserted in `computer-parts.test.ts`.
- `packOf` read the tarball with `resolve(file)`, so a `pnpm` that prints the name alone was looked for in the working directory: `ENOENT: no such file or directory, open '<repo>/packed-3182646.tgz'`. It is `resolve(into, file)` now, which is where the pack was told to write and is the same answer for an absolute path. The case is `reads the tarball a pack named relatively, against the directory it packed into`, over a fake `pnpm` that prints the name alone.

## Left for later

- A problem met while writing task 04's cases is filed rather than fixed: every message an entry read from a parts file produces names the shipped `versions.json`, whatever path was read - [a-parts-file-read-from-elsewhere-reports-the-shipped-one.md](../../../problems/a-parts-file-read-from-elsewhere-reports-the-shipped-one.md).
- An npm part is still not reproducible, as [deferred.md](deferred.md) records.
