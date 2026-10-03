---
title: A profile picks the mode, and a machine gets its state volumes
status: todo
depends: [task-01-the-sdk-has-a-state-need.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/manifest.ts#L34-L100](../../../../packages/computer/src/manifest.ts#L34-L100) - `Profile`"
  - "[code://packages/computer/src/manifest.ts#L574-L592](../../../../packages/computer/src/manifest.ts#L574-L592) - where the mode is passed to resolution"
  - "[code://packages/computer/src/runtime.ts#L697-L746](../../../../packages/computer/src/runtime.ts#L697-L746) - the run flags"
  - "[code://packages/computer/src/runtime.ts#L656-L697](../../../../packages/computer/src/runtime.ts#L656-L697) - `devcontainer up`, which takes `--mount type=volume`"
  - "[code://packages/computer/src/plugin.ts#L445-L453](../../../../packages/computer/src/plugin.ts#L445-L453) - `remove`, where a machine made without a profile loses its volumes"
---

## Objective

`Profile.state` is `volume` by default or `host`; in `volume` each state need becomes `-v ahpd-state-<profile>-<name>:<state>`, where `<name>` is the whole state directory with its slashes as dashes (`/ahpd/claude` is `ahpd-claude`), and the machine is labelled `ahpd.state=<mode>`.
Variants of one plugin that declare one state directory share its volume.

## Files

- `UPDATE: packages/computer/src/manifest.ts` - the field and the mode passed to resolution.
- `UPDATE: packages/computer/src/runtime.ts` - `MachineSpec.states`, the flags, and `--mount type=volume` on the dev container route.
- `UPDATE: packages/computer/src/runtime.ts` - `stateVolumeOf(owner, state)`, the one function that names a state volume from the profile (or machine id) and the state directory.
- `UPDATE: packages/computer/src/plugin.ts` - removing a machine made without a profile removes its state volumes.
- `UPDATE: packages/computer/test/computer-needs.test.ts`.

## Steps

1. Pass the mode to `resolveNeeds`.
2. Name volumes through `stateVolumeOf`: by profile and the whole state directory; without a profile, by machine id and that directory. The provider is not in the name, so the variants of one plugin share one volume.
3. A state need identical to another collapses with it (task 05); refuse a state target that collides with a differing need, as any other target.

## Validation

- Two machines of one profile mount one volume; a manifest without a profile gets its own and loses it on delete.
- `state: "host"` produces today's flags exactly.
- A profile naming `claude` and a Claude variant mounts `ahpd-state-<profile>-ahpd-claude` once at `/ahpd/claude`.

## Resume
