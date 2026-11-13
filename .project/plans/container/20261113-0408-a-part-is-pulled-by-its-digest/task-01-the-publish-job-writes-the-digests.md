---
title: The publish job writes the digests
status: implemented
depends: []
layer: "scripts"
refs:
  - "[code://scripts/parts-publish.mjs#L65](../../../../scripts/parts-publish.mjs#L65) - `published`, the registry read the digest read sits beside"
  - "[code://scripts/parts-publish.mjs#L143-L174](../../../../scripts/parts-publish.mjs#L143-L174) - the loop that leaves or pushes each image"
  - "[code://packages/computer/test/parts-publish.test.ts](../../../../packages/computer/test/parts-publish.test.ts) - the cases this task adds to"
---

## Objective

`parts-publish.mjs --push` writes `packages/computer/images/digests.json`, with the `sha256:` digest of each image it pushed or found published, by local tag.
Without `--push` it writes no file.

## Files

- `UPDATE: scripts/parts-publish.mjs:65` - add `digestOf(reference)`, which reads a published image's digest with `docker buildx imagetools inspect`.
- `UPDATE: scripts/parts-publish.mjs:143-174` - keep the digest of each image left as published or pushed, and write the file before the exit.
- `UPDATE: packages/computer/test/parts-publish.test.ts` - the cases for the file, with the fake docker answering a digest.
- `UPDATE: .gitignore` - name `packages/computer/images/digests.json`.

## Steps

1. Add `digestOf(reference)` to `parts-publish.mjs`, which runs `docker buildx imagetools inspect <reference> --format '{{json .Manifest}}'`.
2. Answer the `digest` of that JSON when it starts with `sha256:`, and `undefined` for anything else.
3. In the loop, read the digest of an image that `published` finds, and keep it under the image's local tag.
4. After `docker buildx build --push` succeeds, read the image's digest the same way, and keep it.
5. Count an image whose digest is `undefined` after a push as failed, with a line that names it.
6. With `--push`, write the kept digests to `packages/computer/images/digests.json`, sorted by tag, two-space indented, with a final newline.
7. Write no file without `--push`, and none with `--local`.
8. Add `packages/computer/images/digests.json` to `.gitignore`.
9. Update the header comment of `parts-publish.mjs` to say that `--push` writes the file.

## Validation

- `packages/computer/test/parts-publish.test.ts`: a push writes one digest for each part and one for the joined image, by local tag.
- The same file: an image already published gets its digest from the inspect, with no build.
- The same file: an inspect with no `sha256:` digest after a push fails the run and names the image.
- The same file: a rehearsal and a `--local` run write no file.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/computer/test/parts-publish.test.ts` passes.

## Resume
- Implemented on 2026-11-13. [implemented.md](implemented.md) holds what was built, what was verified and the departures.
