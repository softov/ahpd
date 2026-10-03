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

1. Probe once: `docker create --mount type=image,source=<node tag>,target=/probe <node tag> x`, then remove it; success means yes. Keep the answer for the daemon's life.
2. Add the flags after the bind mounts.
3. Ignore Docker's experimental warning on stderr.

## Validation

- With the fake accepting image mounts, the flags are present for each part.
- By hand on Docker 29: a codex machine runs `/opt/ahpd/codex/bin/codex-acp --help`.

## Resume
