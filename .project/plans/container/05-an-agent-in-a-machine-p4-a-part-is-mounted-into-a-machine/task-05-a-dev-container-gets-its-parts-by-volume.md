---
title: A dev container gets its parts as a Docker machine does
status: todo
depends: [task-04-a-volume-is-the-fallback.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L656-L697](../../../../packages/computer/src/runtime.ts#L656-L697) - `devcontainer up`, where copies become mounts"
  - "[code://packages/computer/src/runtime.ts#L494-L500](../../../../packages/computer/src/runtime.ts#L494-L500) - `cliMount`, which writes every mount as a bind"
  - "[code://.project/decisions/a-dev-container-is-reached-by-docker-exec.md](../../../decisions/a-dev-container-is-reached-by-docker-exec.md) - one reach path, so parts can be image mounts in a dev container too"
  - "[code://.project/plans/container/03-a-dev-container-is-a-computer/task-09-read-only-needs-through-an-override-config.md](../03-a-dev-container-is-a-computer/task-09-read-only-needs-through-an-override-config.md) - the override configuration a read-only mount and `runArgs` go through"
  - "[code://packages/computer/test/fixtures/devcontainer.mjs](../../../../packages/computer/test/fixtures/devcontainer.mjs) - the fake CLI"
---

## Objective

A dev container made for an agent with a part gets it the way a Docker machine does: an image mount where the probe says Docker takes one, and the part's volume otherwise.

## Files

- `UPDATE: packages/computer/src/runtime.ts:656-697` - the part mounts at `up`: an image mount as `--mount`, `type=image,source=<tag>,target=/opt/ahpd/<part>,readonly` in the override config's `runArgs` through `container/03` task 09's `overrideOf`; a volume mount in the override's `mounts`.
- `UPDATE: packages/computer/src/runtime.ts` - `devcontainerPartRoute()`, beside task 03's probe: answers `image` where the probe says Docker takes image mounts and the real-CLI check of step 1 held, `volume` otherwise; the one place the route is chosen.
- `UPDATE: packages/computer/test/fixtures/devcontainer.mjs` - records the part mounts.
- `UPDATE: packages/computer/test/devcontainer.test.ts` - both routes.

## Steps

1. Check first, against a real `@devcontainers/cli`, that a `--mount type=image,...` entry in the override config's `runArgs` reaches `docker run` and the container has the part; write in this task's Resume what was seen. If it fails, `devcontainerPartRoute` answers `volume` always, and the Resume says why.
2. Image route: the `runArgs` entry, with the same `type=image` fields as task 03.
3. Volume route: ensure each part's volume (task 04), then mount it read-only through the override configuration's `mounts`, because the CLI refuses `,readonly` in `--mount` (container/03 task 09).
4. `cliMount` stays for binds; parts never pass through it.

## Validation

- With the fake accepting image mounts, a dev container for an agent with a part carries the image mount; refusing them, it carries the volume mount.
- By hand: a dev container runs `/opt/ahpd/codex/bin/codex-acp --help` through `docker exec`.

## Resume
