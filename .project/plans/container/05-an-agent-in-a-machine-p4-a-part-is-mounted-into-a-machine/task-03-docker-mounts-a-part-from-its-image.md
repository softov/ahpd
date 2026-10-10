---
title: Docker mounts a part from its image
status: done
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

- Built 2026-10-05. `canMountImages` in `dockerRuntime` (`runtime.ts`) probes with `docker create --name ahpd-part-probe-<n> --mount type=image,source=<first part's tag>,target=/probe <tag> x` and `rm -f`; a yes, and a refusal naming the mount type, are kept for the runtime's life, and any other failure is asked again. Each part is `--mount type=image,source=<tag>,image-subpath=opt/ahpd/<id>,target=/opt/ahpd/<id>,readonly` after the binds. Success is the exit code, so the experimental warning on stderr is not a failure.
- The fake's switch is a state-file field (`imageMounts: false`, answered in the daemon's words `invalid mount config for type "image": mount type unknown`; `failMount` for any other refusal), as `failBuild` and `failRun` are, rather than an environment variable. A container made with no `--label` is no longer listed by the fake, as with real Docker.
- Tests: `computer-parts-mount.test.ts` "mounts each part from its own image where Docker takes one, after the binds" and "asks again after a probe the image failed, and keeps a refusal of the mount type"; both failed before the change.
- Real Docker 29.6.2, 2026-10-05, through the built runtime: a `debian:bookworm-slim` machine with `codex` and `node` had `PATH=/opt/ahpd/codex/bin:/opt/ahpd/node/bin:/usr/local/sbin:...`, `command -v codex-acp` answered `/opt/ahpd/codex/bin/codex-acp`, `node --version` answered `v24.21.0`, and a write under `/opt/ahpd/codex` was refused as read-only. A probe naming a source image that is not there failed with "Unable to find image '<the container's image>' locally ... pull access denied", the misleading message task 05 records. `codex-acp --help` prints nothing and waits on stdin, since it is an ACP server, so the check used `command -v` and Node instead. Containers removed.
