---
title: Docker takes every value by name, and a vault-named value only on each exec
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L562-L620](../../../../packages/computer/src/plugin.ts#L562-L620) - `reach`, the exec answer; `into` at L606"
  - "[code://packages/computer/src/runtime.ts#L731](../../../../packages/computer/src/runtime.ts#L731) - the run flags"
  - "[code://packages/computer/src/runtime.ts#L570-L577](../../../../packages/computer/src/runtime.ts#L570-L577) - `must`"
  - "[code://packages/computer/src/runtime.ts#L325-L340](../../../../packages/computer/src/runtime.ts#L325-L340) - `ran`, which spawns with an env of its own"
  - "[code://packages/computer/src/secrets.ts#L53-L78](../../../../packages/computer/src/secrets.ts#L53-L78) - `revealed`, which answers plain strings and loses which values came from a `$secret`"
  - "[code://packages/sdk/src/types/machine.ts#L81-L94](../../../../packages/sdk/src/types/machine.ts#L81-L94) - `ResolvedNeed`, which has no marker for a vault-named value"
  - "[code://packages/computer/src/plugin.ts#L403-L412](../../../../packages/computer/src/plugin.ts#L403-L412) - `claimOf`, a machine's owner and team from its labels or, for a dev container, the record beside the config"
  - "[code://packages/computer/src/plugin.ts#L787-L803](../../../../packages/computer/src/plugin.ts#L787-L803) - the `SecretWork` and the two `revealed` calls at create"
  - "[code://packages/computer/src/manifest.ts#L34-L100](../../../../packages/computer/src/manifest.ts#L34-L100) - `Profile`, which gains `secretUnreadable`"
  - "[code://packages/computer/src/plugin.ts#L142-L178](../../../../packages/computer/src/plugin.ts#L142-L178) - `profilesOf`, where a profile's flat fields are read"
  - "[code://packages/computer/src/plugin.ts#L85-L91](../../../../packages/computer/src/plugin.ts#L85-L91) - the `profiles` schema"
---

## Objective

`docker exec` and `docker run` are given `-e NAME` for every asked value, and the values travel in the spawned process's environment.
For now the names the `docker` program itself reads, `PATH`, `HOME` and `DOCKER_HOST`, stay `-e NAME=VALUE`, since putting them in docker's own environment changes how docker runs.
A value named from the vault is never given to `docker run`: it is held with the machine and passed by name on each `docker exec`, so `docker inspect` never shows it in `Config.Env`.
After a daemon restart a vault-named value is read again on the next reach, and when that read fails, the profile's `secretUnreadable` decides: `"fail"`, the default, fails every exec into the machine with a line naming the need, and `"drop"` leaves only that variable out of the exec and logs the line.

## Files

- `UPDATE: packages/computer/src/plugin.ts:606` - `into` becomes names; the answered `env` is the runtime's own `env` with the asked values laid over it, the machine's held vault-named values among them.
- `UPDATE: packages/computer/src/runtime.ts:731` - names in the flags; the `run` or `create` call spawns with the values in its env; a need with `named: true` is left out of the flags and the env.
- `UPDATE: packages/computer/src/runtime.ts:570-577` - `must` takes an optional env, passed to `ran` over the runtime's own.
- `UPDATE: packages/computer/src/runtime.ts:67` - `MachineSpec.named`, the need names that are vault-named.
- `UPDATE: packages/computer/src/secrets.ts:53-78` - `revealed` answers `{ values, named }`, where `named` is the `Set` of need names whose value came from a `$secret`; every caller in `plugin.ts` and `provider.ts` reads `values`.
- `UPDATE: packages/sdk/src/types/machine.ts:81-94` - `ResolvedNeed.named`, set on an env need whose value came from the vault.
- `UPDATE: packages/computer/src/manifest.ts:34-100` - `Profile.secretUnreadable?: 'fail' | 'drop'`, with a comment saying what each value does and that absent is `fail`.
- `UPDATE: packages/computer/src/plugin.ts:85-91,142-178` - `secretUnreadable` in the profile schema as an enum of `fail` and `drop`, and read by `profilesOf`; the held values per machine and the re-read in `reach`.
- `UPDATE: packages/computer/test/fixtures/docker.mjs` - `-e NAME` resolves from its own environment and fails when absent, as Docker does.
- `UPDATE: packages/computer/test/computer-spawn.test.ts` - the exec cases below.
- `UPDATE: packages/computer/test/computer-needs.test.ts` - the create cases below.
- `UPDATE: packages/computer/test/computer-options.test.ts` - the schema case below.

## Steps

1. Add a small helper in `runtime.ts`, exported for `plugin.ts`: `byName(env) -> { flags: ['-e', NAME, ...], env: { NAME: VALUE } }`, with `DOCKER_OWN = ['PATH', 'HOME', 'DOCKER_HOST']` beside it; a name in that list is written `-e NAME=VALUE` and kept out of the returned env. The list is the one place the choice is made.
2. Use it for the exec answer in `reach`; keep `-w` and the order of flags as they are.
3. Give `must` an optional env argument and use the helper for `run` and for `create` on the copy-in route.
4. Make `revealed` answer `{ values, named }`, thread `named` through `ManifestDefaults` into `MachineSpec.named`, and have `manifestOf` copy it onto each env `ResolvedNeed` it builds as `named: true`, so the split in step 5 reads one field.
5. Split a machine's resolved env by `ResolvedNeed.named`: the rest goes to `docker run` by name as in step 3, and the vault-named values are kept in memory with the machine for its life in this daemon, never in `computers.json`, and laid over the answered env of every `docker exec` into it.
6. After a daemon restart, a vault-named value is read again when the machine is next reached: the `SecretWork` is the machine's owner and team from `claimOf(id)`, the needs are the vault-named ones under the plugin's `needs` and the machine's profile `needs`, for the agents the machine's `ahpd.agents` label names, and `revealed` reads them as at create.
7. When that read fails, read the machine's profile `secretUnreadable`: with `fail`, or no profile, `reach` throws a sentence naming the need and the secret, and every later reach tries the read again; with `drop`, the exec runs without that variable and one line naming the need is logged per reach.
8. Teach the fake Docker to resolve `-e NAME` from its own environment and to record the resolved value on the machine. The fake fails when `NAME` is absent from its environment, which is stricter than real Docker: Docker drops an unset `-e NAME` silently and the variable is simply missing inside. The strictness is on purpose, so a caller that loses the env is a failing test and not a missing variable; the docs and the fake's comment say so.

## Validation

Write each case first and see it fail against today's code, then build until it passes.

- `computer-spawn.test.ts`: an exec asked with `{ KEY: 'secret' }` answers args with `-e` and `KEY` and no `secret`, and `env.KEY === 'secret'`.
- `computer-needs.test.ts`: a create with a plain env need records no value in the fake's argv, and the machine's recorded env has it.
- `computer-spawn.test.ts`: an exec asked with `{ PATH: '/opt/x/bin:/usr/bin', KEY: 'secret' }` answers `-e PATH=/opt/x/bin:/usr/bin` and `-e KEY`, and the answered env has `KEY` and not the asked `PATH`.
- `computer-spawn.test.ts`: a caller that spawns the answered descriptor without its `Spawn.env` (args only, `process.env` as it is) makes the fake Docker fail naming `KEY`, so a backend that drops the env is caught.
- `computer-needs.test.ts`: `revealed` answers `named` holding exactly the needs written as `$secret`.
- `computer-needs.test.ts`: a create with a need written as `{ "$secret": "host:k" }` records no `docker run` argv naming that need and no such variable in the machine's recorded create env, and the next exec answers `-e` with the need's name and the value in its env.
- `computer-spawn.test.ts`: after the plugin is loaded again with the same fake vault, the next exec into the machine passes the vault-named value by name, read for the owner `claimOf` answers.
- `computer-spawn.test.ts`: after the plugin is loaded again with the secret removed from the fake vault and a profile without `secretUnreadable`, the exec fails with a sentence naming the need, and a second exec fails the same way.
- `computer-spawn.test.ts`: the same with `secretUnreadable: "drop"` answers an exec without that variable, keeps every other variable, and logs one line naming the need.
- `computer-options.test.ts`: a profile with `secretUnreadable: "drop"` validates, and one with `secretUnreadable: "skip"` is refused, naming the field.
- `pnpm --filter @ahpd/computer test` and `pnpm --filter @ahpd/sdk test` green.

## Resume
