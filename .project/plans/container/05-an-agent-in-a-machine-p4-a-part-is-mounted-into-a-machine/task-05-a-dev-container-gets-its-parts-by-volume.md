---
title: A dev container gets its parts as a Docker machine does
status: implemented
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

1. The image route works: checked on 2026-10-03 against `@devcontainers/cli@0.89.0` and Docker 29.6.2 (`container/03` task 17), `--mount type=image,source=busybox:latest,target=/opt/bb` in an override's `runArgs` reached `docker run`, mounted read-only, and ran. The source image must already be present: with it absent, `docker run` failed with a misleading "pull access denied for vsc-...". So the part image is ensured (built or pulled, task 02) before `up`, and `devcontainerPartRoute` keeps the volume route for a runtime where the check fails.
2. Image route: the `runArgs` entry, with the same `type=image` fields as task 03, after the part image is present.
3. Volume route: ensure each part's volume (task 04), then mount it read-only through the override configuration's `mounts`, because the CLI refuses `,readonly` in `--mount` (container/03 task 09).
4. `cliMount` stays for binds; parts never pass through it.

## Validation

- With the fake accepting image mounts, a dev container for an agent with a part carries the image mount; refusing them, it carries the volume mount.
- By hand: a dev container runs `/opt/ahpd/codex/bin/codex-acp --help` through `docker exec`.

## Resume

- Built 2026-10-05. `devcontainerPartRoute` beside the probe in `dockerRuntime` answers `image` where `canMountImages` does and `volume` otherwise. `overrideOf` takes the route: `image` adds `--mount type=image,...` (the task 03 fields, `image-subpath` included) to `runArgs`; `volume` fills each volume first and adds `type=volume,source=<volume>,target=/opt/ahpd/<id>,readonly` to `mounts`. Both add the `ahpd.parts` label to `runArgs`. `cliMount` is untouched and parts never pass through it.
- The task's line refs (`runtime.ts:656-697`, `494-500`) had moved; the code is `overrideOf` and the dev container branch of `run`.
- Tests: `devcontainer.test.ts` "gives a dev container its parts as image mounts in runArgs..." and "...as read-only volumes where Docker refuses image mounts"; both failed before the change. The fake CLI records `runArgs` `--mount` entries and refuses an image mount whose source is not in the Docker state with "pull access denied for vsc-<folder>", as the real pair does.
- Real check, 2026-10-05, `@devcontainers/cli` 0.89.0 and Docker 29.6.2 through the built runtime: a dev container from `{ "image": "debian:bookworm-slim" }` with `codex` and `node`, once by each route, answered `command -v codex-acp` with `/opt/ahpd/codex/bin/codex-acp` through `docker exec` with `PATH=/opt/ahpd/codex/bin:/opt/ahpd/node/bin:...`, Node answered, and `/opt/ahpd/codex` was read-only. Containers, volumes and folders removed.
