---
title: Docker takes every value by name, and a vault-named value only on each exec
status: implemented
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

Implemented on 2026-10-05, on main after container/03 (`52f98f6`).

Files changed:

- `packages/computer/src/byname.ts` (new) - `DOCKER_OWN` (`PATH`, `HOME`), `DOCKER_OWN_PREFIX` (`DOCKER_`), `dockerOwn` and `byName`; a name `dockerOwn` answers stays `-e NAME=VALUE` and never enters the spawn env. A file of its own rather than inside `runtime.ts`, because the relay in `devcontainer.ts` uses it and `runtime.ts` already imports `devcontainer.ts`; `runtime.ts` re-exports both, so `plugin.ts` imports them from there as the plan says.
- `packages/computer/src/runtime.ts` - `ran` and `must` take an env laid over the runtime's own; `MachineSpec.named`; `madeWith` leaves the vault-named variables out of what a machine is made with; `run` and `create` pass every other one by name; `exec` takes an optional env and passes it by name on both recipes.
- `packages/computer/src/secrets.ts` - `revealed` answers `{ values, named }`, `named` mapping each vault-named need to the secret it named; `vaultNamed` picks the winning source per need (the profile's, else the option's); `namedAgain` reads the vault-named env needs again, one at a time, and answers what it read beside what it could not; `madeAgain` reads the needs a machine was recorded with.
- `packages/sdk/src/types/machine.ts` - `ResolvedNeed.named`.
- `packages/computer/src/manifest.ts` - `Profile.secretUnreadable`; `ManifestDefaults.named`; `manifestOf` marks each env `ResolvedNeed` whose need is vault-named and answers each as `{ need, variable, secret }` in `MachineSpec.named`.
- `packages/computer/src/owners.ts` - `MadeNeed`, an entry's `needs`, `madeNeedsOf` and `keepMadeNeeds`; a missing `computers.json` reads as empty without a log line.
- `packages/computer/src/provider.ts` - reads `values` from `revealed` and hands `vaultNamed(own, values)` to `manifestOf`.
- `packages/computer/src/plugin.ts` - `secretUnreadable` in the profile schema and in `profilesOf`; `vaulted`, the held values per machine id, filled by `made.run` and cleared by `made.remove`; `made.run` records the needs in the machine's `computers.json` entry by need, variable and secret name; `namedFor`, which answers the held values or reads them again for `claimOf(id)` from that record, or, with none recorded, from the machine's `ahpd.agents` and its `ahpd.profile`, and applies `secretUnreadable`; `reach` passes the held values under the asked ones through `byName`; `made.exec` gives a tool's command the same.
- `packages/computer/test/fixtures/docker.mjs` - `-e NAME` read from its own environment on `run`, `create` and `exec`, refused when absent.

Tests: "passes each asked variable by name, and keeps the names docker reads as written", "keeps every DOCKER_ name out of the environment docker is spawned with" and the updated "answers how to reach a machine" in `computer-plugin.test.ts`; in `computer-needs.test.ts` the five existing secret cases now assert the machine's record lacks the value and the next exec carries it, plus "answers which needs a reference gave their value", "reads a vault-named value again after a restart", "fails every command into the machine when a vault-named value cannot be read again" and "drops only the unreadable variable and logs it", "makes a machine with a DOCKER_ need without running docker under it", "reads a session machine's own vault-named need again after a restart, from the reference it was made with" and "reads a machine with no recorded needs again from the needs its agents declare"; "takes a profile's secretUnreadable as fail or drop" in `computer-options.test.ts`. Each new or changed case was run against the tree at `HEAD` with the new tests and fixture copied in, and failed there.

Differences from the steps:

- The exec cases are in `computer-plugin.test.ts`, beside the existing reach test, not in `computer-spawn.test.ts`, which tests Claude's `spawnInside` and loads no plugin.
- `MachineSpec.named` lists `{ need, variable, secret }`: the runtime works in the variables, and the plugin records all three.
- The loader's schema check does not walk the values of an `additionalProperties` map, so a profile's `secretUnreadable: "skip"` passed it. `apply` refuses it instead, naming `profiles.<key>.secretUnreadable`, as it refuses a bad `images` pattern.
- `secretUnreadable` applies to every command into the machine: `how`, the nested host (which goes through `how`), `computer_exec` and the relay.
- Checked against Docker 29.6.2 on the workstation with the built runtime: a machine made with a plain and a vault-named variable had only the plain one in `Config.Env`, `exec` with the vault-named one by name printed it, and `ps -ww` during a `docker exec -e ANTHROPIC_API_KEY` showed the name and not the value.
