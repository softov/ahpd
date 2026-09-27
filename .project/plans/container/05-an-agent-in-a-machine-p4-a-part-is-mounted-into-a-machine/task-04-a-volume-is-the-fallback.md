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

1. `docker volume inspect`; present means filled.
2. Absent: `docker create -v <volume>:/opt/ahpd/<id> <tag> x`, start nothing, remove it; Docker fills an empty volume from the image at the mount point. Verify on a real Docker that a scratch image fills it at create; if it does only at start, stream `docker cp <container>:/opt/ahpd/<id> -` into a helper that has the volume, and write which in Resume.
3. One fill per volume at a time, the same way builds are shared.

## Validation

- With the fake refusing image mounts, the flags are `-v` volumes and each volume is filled once across two machines.
- By hand: the same codex machine as task 03, with image mounts switched off by option.

## Resume
