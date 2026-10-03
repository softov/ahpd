---
title: Docker takes every value by name
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L562-L620](../../../../packages/computer/src/plugin.ts#L562-L620) - `reach`, the exec answer; `into` at L606"
  - "[code://packages/computer/src/runtime.ts#L731](../../../../packages/computer/src/runtime.ts#L731) - the run flags"
  - "[code://packages/computer/src/runtime.ts#L570-L577](../../../../packages/computer/src/runtime.ts#L570-L577) - `must`"
  - "[code://packages/computer/src/runtime.ts#L325-L340](../../../../packages/computer/src/runtime.ts#L325-L340) - `ran`, which spawns with an env of its own"
---

## Objective

`docker exec` and `docker run` are given `-e NAME` for every asked value, and the values travel in the spawned process's environment.
For now the names the `docker` program itself reads, `PATH`, `HOME` and `DOCKER_HOST`, stay `-e NAME=VALUE`, since putting them in docker's own environment changes how docker runs.

## Files

- `UPDATE: packages/computer/src/plugin.ts:606` - `into` becomes names; the answered `env` is the runtime's own `env` with the asked values laid over it.
- `UPDATE: packages/computer/src/runtime.ts:731` - names in the flags; the `run` or `create` call spawns with the values in its env.
- `UPDATE: packages/computer/src/runtime.ts:570-577` - `must` takes an optional env, passed to `ran` over the runtime's own.
- `UPDATE: packages/computer/test/fixtures/docker.mjs` - `-e NAME` resolves from its own environment and fails when absent, as Docker does.
- `UPDATE: packages/computer/test/computer-spawn.test.ts` - the exec cases below.
- `UPDATE: packages/computer/test/computer-needs.test.ts` - the create case below.

## Steps

1. Add a small helper in `runtime.ts`, exported for `plugin.ts`: `byName(env) -> { flags: ['-e', NAME, ...], env: { NAME: VALUE } }`, with `DOCKER_OWN = ['PATH', 'HOME', 'DOCKER_HOST']` beside it; a name in that list is written `-e NAME=VALUE` and kept out of the returned env. The list is the one place the choice is made.
2. Use it for the exec answer in `reach`; keep `-w` and the order of flags as they are.
3. Give `must` an optional env argument and use the helper for `run` and for `create` on the copy-in route.
4. Teach the fake Docker to resolve `-e NAME` from its own environment and to record the resolved value on the machine.

## Validation

- `computer-spawn.test.ts`: an exec asked with `{ KEY: 'secret' }` answers args with `-e` and `KEY` and no `secret`, and `env.KEY === 'secret'`.
- `computer-needs.test.ts`: a create with an env need records no value in the fake's argv, and the machine's recorded env has it.
- `computer-spawn.test.ts`: an exec asked with `{ PATH: '/opt/x/bin:/usr/bin', KEY: 'secret' }` answers `-e PATH=/opt/x/bin:/usr/bin` and `-e KEY`, and the answered env has `KEY` and not the asked `PATH`.
- `pnpm --filter @ahpd/computer test` green.

## Resume
