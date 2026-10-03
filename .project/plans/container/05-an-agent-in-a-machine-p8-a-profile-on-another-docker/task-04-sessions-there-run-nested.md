---
title: Sessions in a machine on another Docker run nested
status: todo
depends: [task-01-a-profile-names-its-docker.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L634-L646](../../../../packages/computer/src/plugin.ts#L634-L646) - `nestedHost`"
---

## Objective

The port says a machine from a remote runner is `remote`, so every backend runs nested there, and `nested` answers `docker exec -i <name> ahpd --stdio` with that runner's `DOCKER_HOST` in the descriptor's `env`.

## Files

- `UPDATE: packages/computer/src/runtime.ts` - `how` puts the runner's `env` in the descriptor; `within` answers nothing for a remote runner.
- `UPDATE: packages/computer/test/computer-spawn.test.ts`.

## Steps

1. The inner working directory is the clone's, by container/04 task 14.
2. A restart leaves the session to resume, by p9 task 05.

## Validation

- A remote machine's `nested` descriptor holds `DOCKER_HOST` in `env` and no `-v`-mapped `-w`.

## Resume
