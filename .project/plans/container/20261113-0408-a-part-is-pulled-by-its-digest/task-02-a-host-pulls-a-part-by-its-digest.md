---
title: A host pulls a part by its digest
status: todo
depends: [task-01-the-publish-job-writes-the-digests.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/parts.ts#L62](../../../../packages/computer/src/parts.ts#L62) - `versionsPath`, the pattern for the path of the digests file"
  - "[code://packages/computer/src/parts.ts#L986](../../../../packages/computer/src/parts.ts#L986) - the part pull"
  - "[code://packages/computer/src/parts.ts#L1323](../../../../packages/computer/src/parts.ts#L1323) - the joined image pull"
  - "[code://packages/computer/src/runtime.ts#L3734-L3741](../../../../packages/computer/src/runtime.ts#L3734-L3741) - `pullImage(from, tag)`, which takes a digest reference as it is"
  - "[code://packages/computer/test/computer-parts-build.test.ts#L77-L130](../../../../packages/computer/test/computer-parts-build.test.ts#L77-L130) - the pull cases this task adds to"
---

## Objective

A host pulls a part and the joined image as `<registry>/<name>@<digest>` when `digests.json` has a digest for the tag.
The image keeps its local tag, as before.
With no digest, it pulls by the tag, as today, and logs a warning that names the tag.

## Files

- `UPDATE: packages/computer/src/parts.ts:62` - add `digestsPath` and `digestOf(tag)`, which read `images/digests.json` once and answer `undefined` for a missing file or tag.
- `UPDATE: packages/computer/src/parts.ts:986` - pull a part by its digest when `digestOf` answers one.
- `UPDATE: packages/computer/src/parts.ts:1323` - pull the joined image by its digest when `digestOf` answers one.
- `UPDATE: packages/computer/test/computer-parts-build.test.ts` - the digest and no-digest cases for a part and for the joined image.

## Steps

1. Add `digestsPath()` beside `versionsPath()`, at `../images/digests.json`.
2. Add `digestOf(tag)`, which reads and parses the file once per process and answers the digest of `tag`.
3. Answer `undefined` when the file is missing, and refuse a file that is not an object of `sha256:` strings.
4. Add `remoteOf(tag, log)`, which answers `<registry>/<name>@<digest>` with a digest, else `<registry>/<tag>`.
5. Make `remoteOf` log `<tag> has no pinned digest, so it is pulled by its tag` at `warn` when it has no digest.
6. Use `remoteOf` at the part pull and at the joined image pull, and keep `tag` as the local tag.
7. Leave the build of a checkout's own `ahpd` part as it is: it pulls nothing.
8. Let `digestOf` take the path of the file as an argument, so a test writes a file of its own.

## Validation

- `packages/computer/test/computer-parts-build.test.ts`: with a digest for a part's tag, the pull names `<registry>/ahpd-part/<id>@sha256:...` and the local tag stays `ahpd-part/<id>:<tag>`.
- The same file: with no digests file, the pull names `<registry>/<tag>`.
- The same file: with no digests file, the log holds one warning that names the tag.
- The same file: a digest for the joined image makes its pull name `@sha256:`.
- The same file: a malformed digests file refuses the part.
- The same file: that refusal names the file.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/computer` passes.

## Resume
