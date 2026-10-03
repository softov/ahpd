---
title: A volume is the fallback
status: todo
depends: [task-03-docker-mounts-a-part-from-its-image.md]
layer: "computer"
refs:
  - https://docs.docker.com/engine/storage/volumes/ - an empty named volume is filled from the image's content at its mount point
---

## Objective

Where the probe says no, each part is `-v ahpd-part-<id>-<version>:/opt/ahpd/<id>:ro`, and the volume is filled from the part image once.

## Files

- `UPDATE: packages/computer/src/runtime.ts` - `ensurePartVolume(part)`.
- `UPDATE: packages/computer/test/fixtures/docker.mjs` - volumes and the fill.

## Steps

1. `docker volume inspect` and a check for the marker file `/opt/ahpd/<id>/.ahpd-filled` in it; present with the marker means filled. A volume present without the marker is a fill that did not finish: remove it and fill again.
2. Absent: `docker create -v <volume>:/opt/ahpd/<id> <tag> x`, start nothing, remove it; Docker fills an empty volume from the image at the mount point. Then write the marker into the volume with a helper container, last, so a fill that stops half way is never taken as done.
3. One fill per volume at a time, the same way builds are shared.
4. Whether a real Docker fills a volume from a `FROM scratch` image at create, or only at start, is checked by hand (Softov) on a real Docker; the build agent keeps the fake and does not settle it. If the hand check says only at start, the fill streams `docker cp <container>:/opt/ahpd/<id> -` into the helper, and that is a change made after the check.

## Validation

- With the fake refusing image mounts, the flags are `-v` volumes and each volume is filled once across two machines.
- A volume the fake holds without the marker is removed and filled again, and the marker is written after the fill.
- By hand (Softov): on a real Docker, whether `docker create` alone fills the volume from the scratch part image; the same codex machine as task 03, with image mounts switched off by option.

## Resume
