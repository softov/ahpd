---
title: Docker takes every value by name
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L394-L408](../../../../packages/computer/src/plugin.ts#L394-L408) - the exec answer"
  - "[code://packages/computer/src/runtime.ts#L635](../../../../packages/computer/src/runtime.ts#L635) - the run flags"
---

## Objective

`docker exec` and `docker run` are given `-e NAME` for every asked value, and the values travel in the spawned process's environment.

## Files

- `UPDATE: packages/computer/src/plugin.ts:394-408` - `into` becomes names; the answered `env` merges the asked values over the runtime's own `env`.
- `UPDATE: packages/computer/src/runtime.ts:635` - names in the flags; `must` for this call spawns with the values in its env.
- `UPDATE: packages/computer/test/fixtures/docker.mjs` - `-e NAME` resolves from its own environment and fails when absent, as Docker does.
- `UPDATE: packages/computer/test/computer-spawn.test.ts` - the cases below.

## Steps

1. Add a small helper in `plugin.ts` beside `into`: `byName(env) -> { flags: ['-e', NAME, ...], env: { NAME: VALUE } }`.
2. Use it for the exec answer; keep `-w` and the order of flags as they are.
3. Give `must` an optional env argument and use the helper for `run` and `create`.
4. Teach the fake Docker to resolve `-e NAME`.

## Validation

- `computer-spawn.test.ts`: an exec asked with `{ KEY: 'secret' }` answers args with `-e`, `KEY` and no `secret`, and `env.KEY === 'secret'`.
- A create with an env need records no value in the fake's argv, and the machine's recorded env has it.
- `pnpm --filter @ahpd/computer test` green.

## Resume
