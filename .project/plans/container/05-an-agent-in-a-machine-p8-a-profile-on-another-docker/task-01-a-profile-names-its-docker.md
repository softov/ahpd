---
title: A profile names its Docker, and its machines' ids say which
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L109-L141](../../../../packages/computer/src/plugin.ts#L109-L141) - `profilesOf`"
  - "[code://packages/computer/src/plugin.ts#L320-L326](../../../../packages/computer/src/plugin.ts#L320-L326) - the plugin's own runner"
  - "[code://packages/computer/src/plugin.ts#L359-L368](../../../../packages/computer/src/plugin.ts#L359-L368) - `claimOf`, through `dockered`"
  - "[code://packages/computer/src/runtime.ts#L602-L620](../../../../packages/computer/src/runtime.ts#L602-L620) - `list`, filtered by the label"
---

## Objective

A profile with `dockerHost` has its own runner, registered with p9's router under its own prefix, and listing, inspecting, metering and owning its machines work as for the local Docker.

## Files

- `UPDATE: packages/computer/src/manifest.ts` - `Profile.dockerHost`.
- `UPDATE: packages/computer/src/plugin.ts:109-141` - read `dockerHost`.
- `UPDATE: packages/computer/src/plugin.ts:73` - the `profiles` description names `dockerHost`.
- `UPDATE: packages/computer/src/plugin.ts:320-326` - one `dockerRuntime` per profile with `dockerHost`, `env: { ...env, DOCKER_HOST }`, `remote: true`, registered with the router.
- `UPDATE: packages/computer/src/plugin.ts:359-368` - `claimOf` inspects through the routed runtime.
- `UPDATE: packages/computer/src/runtime.ts` - `DockerOptions.profile`: the listing adds `--filter label=ahpd.profile=<key>` when set.
- `UPDATE: packages/computer/test/computer-disposable.test.ts`, `computer-uptime.test.ts`.

## Steps

1. For now the id is `docker-<profile>.<name>`, written and read through p9 task 01's `spellMachineId` and `parseMachineId`, never by hand; a profile named like a served runtime value is refused at load.
2. A machine made from such a profile is made by its runner, carries `ahpd.profile=<key>`, and is watched and metered by `made`.
3. A runner whose Docker does not answer leaves its machines out of a listing and logs one line naming the Docker.

## Validation

- With the fake Docker and a profile `far` with `dockerHost`, a disposable machine is made by a run whose env holds `DOCKER_HOST`, listed as `docker-far.<name>`, and its stretch is written with its owner.
- Two profiles on the same `dockerHost` list only their own machines.

## Resume
