---
title: Docker mounts a part from its image
status: todo
depends: [task-02-a-machine-is-made-with-its-parts.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L697-L746](../../../../packages/computer/src/runtime.ts#L697-L746) - the run flags"
  - "[code://packages/computer/test/fixtures/docker.mjs](../../../../packages/computer/test/fixtures/docker.mjs) - learns `type=image`"
---

## Objective

Each part becomes `--mount type=image,source=<tag>,image-subpath=opt/ahpd/<id>,target=/opt/ahpd/<id>,readonly`, when the probe says Docker takes it.

## Files

- `UPDATE: packages/computer/src/runtime.ts` - `canMountImages()` and the flags.
- `UPDATE: packages/computer/test/fixtures/docker.mjs` - accepts or refuses `type=image` by an env switch.

## Steps

1. Probe on the first machine that has a part, after that part's image is ensured: `docker create --mount type=image,source=<that part's tag>,target=/probe <that part's tag> x`, then remove it. Success means yes. Keep the answer for the daemon's life only when it is about the mount type: a refusal that names `type=image` (or an unknown mount type) is a kept no; any other failure (the image missing, Docker unreachable) is not kept, and the next machine probes again. An archive part has no `node` image, so the probe never names an image that may not exist.
2. Add the flags after the bind mounts.
3. Ignore Docker's experimental warning on stderr.

## Validation

- With the fake accepting image mounts, the flags are present for each part.
- The probe names the part being mounted; a probe that fails because the image is missing is asked again for the next machine, and one that fails on the mount type is not.
- By hand on Docker 29: a codex machine runs `/opt/ahpd/codex/bin/codex-acp --help`.

## Resume
