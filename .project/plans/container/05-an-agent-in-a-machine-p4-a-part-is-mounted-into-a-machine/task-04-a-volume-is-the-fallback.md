---
title: A volume is the fallback
status: done
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

- Built 2026-10-05. `ensurePartVolume` in `dockerRuntime`: `docker volume inspect`; a present volume is checked for `/opt/ahpd/<id>/.ahpd-filled` by `docker cp <helper>:<path> -` through a helper created from the part image and never started, and one without it is removed. A fill is `docker create --name ahpd-part-fill-<n> -v ahpd-part-<id>-<version>:/opt/ahpd/<id> <tag> x`, then the marker written last by `docker cp - <helper>:/opt/ahpd/<id>` with a one-file tar on stdin, then `rm -f`. One fill per volume at a time through p3's `once`, now exported from `parts.ts`. Each part is then `-v ahpd-part-<id>-<version>:/opt/ahpd/<id>:ro`.
- The plugin option `imageMounts: false` takes the volume route without probing; it is the "switched off by option" of the validation.
- Beyond the steps: a part whose volume cannot be filled is left out with a log line, and so is a part that requires it, since one broken part must not take the machine down.
- Tests: `computer-parts-mount.test.ts` "mounts each part from a volume filled once...", "fills again a volume that holds no marker, and writes the marker last", "makes the machine without a part whose volume cannot be filled, and without what requires it", and "takes the volumes without asking where the option switches image mounts off"; each failed before the change. The fake learned `volume inspect|rm`, a named volume filled from the image at create, `cp -` into and `cp ... -` out of it, and `failVolume`.
- Step 4's question, seen on Docker 29.6.2 on 2026-10-05: `docker create -v <empty volume>:/opt/ahpd/node ahpd-part/node:24.21.0 x` alone filled the volume from the `FROM scratch` image, for a volume made beforehand and for one the create made, so no `docker cp` stream is needed. The built runtime then made two codex machines from volumes, filling each volume once; inside, `codex-acp` was on the `PATH`, Node answered, and `/opt/ahpd/codex` was read-only and held `.ahpd-filled`. Containers and volumes removed. Softov's own check stays open in the plan's checklist.
