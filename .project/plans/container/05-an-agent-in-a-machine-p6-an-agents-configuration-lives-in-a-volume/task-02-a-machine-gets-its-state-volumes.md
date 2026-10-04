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
  - "[code://packages/computer/src/plugin.ts#L142-L178](../../../../packages/computer/src/plugin.ts#L142-L178) - `profilesOf`, where a profile's flat fields are read"
  - "[code://packages/computer/src/plugin.ts#L403-L412](../../../../packages/computer/src/plugin.ts#L403-L412) - `claimOf`, the machine's owner"
---

## Objective

`Profile.state` is `volume` by default or `host`; in `volume` each state need becomes `-v ahpd-state-<profile>-<owner>-<name>:<state>`, where `<name>` is the whole state directory with its slashes as dashes (`/ahpd/claude` is `ahpd-claude`), and the machine is labelled `ahpd.state=<mode>`.
`Profile.stateScope` is `owner` by default or `shared`; with `shared` the owner is left out of the name, `ahpd-state-<profile>-<name>`, so every owner of the profile shares one volume.
Variants of one plugin that declare one state directory share its volume.

## Files

- `UPDATE: packages/computer/src/manifest.ts` - `state`, `stateScope?: 'owner' | 'shared'` with a comment saying what each value shares, and the mode passed to resolution.
- `UPDATE: packages/computer/src/plugin.ts` - `stateScope` in the profile schema as an enum of `owner` and `shared`, and read by `profilesOf`.
- `UPDATE: packages/computer/src/runtime.ts` - `MachineSpec.states`, the flags, and `--mount type=volume` on the dev container route.
- `UPDATE: packages/computer/src/runtime.ts` - `stateVolumeOf({ profile, owner, id }, state)`, the one function that names a state volume from the profile and owner (or the machine id) and the state directory.
- `UPDATE: packages/computer/src/plugin.ts` - removing a machine made without a profile removes its state volumes.
- `UPDATE: packages/computer/test/computer-needs.test.ts`.
- `UPDATE: packages/computer/test/computer-options.test.ts` - the schema case.

## Steps

1. Pass the mode to `resolveNeeds`.
2. Name volumes through `stateVolumeOf`: by profile, owner and the whole state directory; with `stateScope: "shared"`, by profile and state directory; without a profile, `ahpd-state-<machine id>-<state directory>`. The provider is not in the name, so the variants of one plugin share one volume.
3. The owner is the one the machine is made for, as `claimOf` answers it, lowercased, with every character outside `[a-z0-9-]` written as a dash, so `user:alice` is `user-alice`; a bot, an automation or a plugin that owns a machine is an owner like a person.
4. A state need identical to another collapses with it (task 05); refuse a state target that collides with a differing need, as any other target.

## Validation

Write each case first and see it fail against today's code, then build until it passes.

- Two machines of one profile and one owner mount one volume; a manifest without a profile gets its own and loses it on delete.
- Two machines of one profile made for `user:alice` and `user:bob` mount `ahpd-state-<profile>-user-alice-ahpd-claude` and `ahpd-state-<profile>-user-bob-ahpd-claude`.
- The same two with `stateScope: "shared"` both mount `ahpd-state-<profile>-ahpd-claude`.
- `computer-options.test.ts`: a profile with `stateScope: "shared"` validates, and one with `stateScope: "team"` is refused, naming the field.
- `state: "host"` produces today's flags exactly.
- A profile naming `claude` and a Claude variant mounts `ahpd-state-<profile>-<owner>-ahpd-claude` once at `/ahpd/claude`.

## Resume
