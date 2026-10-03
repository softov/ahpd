---
title: A profile names its Docker, and its machines' ids say which
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L142-L175](../../../../packages/computer/src/plugin.ts#L142-L175) - `profilesOf`"
  - "[code://packages/computer/src/plugin.ts#L354-L360](../../../../packages/computer/src/plugin.ts#L354-L360) - the plugin's own runner"
  - "[code://packages/computer/src/plugin.ts#L403-L412](../../../../packages/computer/src/plugin.ts#L403-L412) - `claimOf`, through `dockered`"
  - "[code://packages/computer/src/runtime.ts#L325-L341](../../../../packages/computer/src/runtime.ts#L325-L341) - `ran`, which has no timeout"
  - "[code://packages/computer/src/plugin.ts#L566-L580](../../../../packages/computer/src/plugin.ts#L566-L580) - the startup adoption, whose failure is swallowed by `.catch(() => {})`"
  - "[code://packages/computer/src/runtime.ts#L602-L620](../../../../packages/computer/src/runtime.ts#L602-L620) - `list`, filtered by the label"
---

## Objective

A profile with `dockerHost` has its own runner, registered with p9's router under its own prefix, and listing, inspecting, metering and owning its machines work as for the local Docker.

## Files

- `UPDATE: packages/computer/src/manifest.ts` - `Profile.dockerHost`.
- `UPDATE: packages/computer/src/plugin.ts:142-175` - read `dockerHost`; a profile whose `dockerHost` equals the plugin's own Docker (its `env.DOCKER_HOST`, or none when that is unset) is skipped with a line, since its machines would be listed twice.
- `UPDATE: packages/computer/src/plugin.ts:73` - the `profiles` description names `dockerHost`.
- `UPDATE: packages/computer/src/plugin.ts:354-360` - one `dockerRuntime` per profile with `dockerHost`, `env: { ...env, DOCKER_HOST }`, `remote: true`, registered with the router.
- `UPDATE: packages/computer/src/plugin.ts:403-412` - `claimOf` inspects through the routed runtime.
- `UPDATE: packages/computer/src/plugin.ts:566-580` - the startup adoption logs one line naming each Docker that did not answer and tries that runner again at the next listing, rather than `.catch(() => {})`.
- `UPDATE: packages/computer/src/runtime.ts` - `DockerOptions.profile`: the listing adds `--filter label=ahpd.profile=<key>` when set; every machine a remote runner makes also carries `ahpd.host=<this host's id>`, and its listing filters on it, so two hosts sharing one remote Docker do not list each other's machines.
- `UPDATE: packages/computer/src/router.ts` (p9 task 01) - a per-runner timeout on every call it routes, so a hung `ssh://` Docker answers as a Docker that did not answer.
- `UPDATE: packages/computer/test/computer-disposable.test.ts`, `computer-uptime.test.ts`.

## Steps

1. For now the id is `docker-<profile>.<name>`, written and read through p9 task 01's `spellMachineId` and `parseMachineId`, never by hand; a profile named like a served runtime value is refused at load.
2. A machine made from such a profile is made by its runner, carries `ahpd.profile=<key>`, and is watched and metered by `made`.
3. A runner whose Docker does not answer, or does not answer within the router's per-runner timeout, leaves its machines out of a listing and logs one line naming the Docker; the listing and the picker answer with the rest. `ran` itself has no timeout, so the bound is the router's, one value per runner.
4. At startup, a runner whose listing fails is logged by name and its adoption is tried again at the next listing; the other runners' machines are adopted.

## Validation

- With the fake Docker and a profile `far` with `dockerHost`, a disposable machine is made by a run whose env holds `DOCKER_HOST`, listed as `docker-far.<name>`, and its stretch is written with its owner.
- Two profiles on the same `dockerHost` list only their own machines.
- Two plugins standing for two hosts on one fake Docker each list only the machines carrying their own `ahpd.host`.
- A profile whose `dockerHost` equals the plugin's own Docker is skipped with a line, and the others load.
- A fake Docker that never answers for profile `far` leaves a listing to answer with the local machines after the timeout, naming `far`'s Docker; one that refuses does the same at once.
- A startup listing that fails for `far` logs one line naming it, and `far`'s disposable machines are adopted at the next listing that reaches it.

## Resume
