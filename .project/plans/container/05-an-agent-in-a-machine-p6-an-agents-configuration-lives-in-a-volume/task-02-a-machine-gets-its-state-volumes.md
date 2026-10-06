---
title: A profile picks the mode, and a machine gets its state volumes
status: implemented
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

`Profile.state` is `volume` by default or `host`; in `volume` each state need becomes `-v ahpd-state-<profile>-<owner>-<provider>:<state>`, where `<provider>` is the id of the agent that declared the need, and the machine is labelled `ahpd.state=<mode>`.
`Profile.stateScope` is `owner` by default or `shared`; with `shared` the owner is left out of the name, `ahpd-state-<profile>-<provider>`, so every owner of the profile shares one volume.
Each provider gets its own volume, so variants of one plugin share no state; a Claude variant's configuration directory defaults to `/ahpd/<provider>`.

## Files

- `UPDATE: packages/computer/src/manifest.ts` - `state`, `stateScope?: 'owner' | 'shared'` with a comment saying what each value shares, and the mode passed to resolution.
- `UPDATE: packages/computer/src/plugin.ts` - `stateScope` in the profile schema as an enum of `owner` and `shared`, and read by `profilesOf`.
- `UPDATE: packages/computer/src/runtime.ts` - `MachineSpec.states`, the flags, and `--mount type=volume` on the dev container route.
- `UPDATE: packages/computer/src/runtime.ts` - `stateVolumeOf({ profile, owner, id }, provider)`, the one function that names a state volume from the profile and owner (or the machine id) and the provider.
- `UPDATE: packages/sdk` or the host, wherever needs are handed to the computer - a resolved state need carries the provider of the agent that declared it.
- `UPDATE: packages/agent-claude/src/claude.ts` - `computerConfigDir` defaults to `/ahpd/<provider>`, and the description in `plugin.ts` says so.
- `UPDATE: packages/computer/src/plugin.ts` - removing a machine made without a profile removes its state volumes.
- `UPDATE: packages/computer/test/computer-needs.test.ts`.
- `UPDATE: packages/computer/test/computer-options.test.ts` - the schema case.

## Steps

1. Pass the mode to `resolveNeeds`.
2. Name volumes through `stateVolumeOf`: by profile, owner and provider; with `stateScope: "shared"`, by profile and provider; without a profile, `ahpd-state-<machine id>-<provider>`. A provider id is written the same way as an owner, lowercased with every character outside `[a-z0-9-]` as a dash.
3. The owner is the one the machine is made for, as `claimOf` answers it, lowercased, with every character outside `[a-z0-9-]` written as a dash, so `user:alice` is `user-alice`; a bot, an automation or a plugin that owns a machine is an owner like a person.
4. A state need identical to another collapses with it (task 05); refuse a state target that collides with a differing need, as any other target.

## Validation

Write each case first and see it fail against today's code, then build until it passes.

- Two machines of one profile and one owner mount one volume; a manifest without a profile gets its own and loses it on delete.
- Two machines of one profile made for `user:alice` and `user:bob` mount `ahpd-state-<profile>-user-alice-claude` and `ahpd-state-<profile>-user-bob-claude`.
- The same two with `stateScope: "shared"` both mount `ahpd-state-<profile>-claude`.
- `computer-options.test.ts`: a profile with `stateScope: "shared"` validates, and one with `stateScope: "team"` is refused, naming the field.
- `state: "host"` produces today's flags exactly.
- A profile naming `claude` and a variant `claude-openrouter` mounts `ahpd-state-<profile>-<owner>-claude` at `/ahpd/claude` and `ahpd-state-<profile>-<owner>-claude-openrouter` at `/ahpd/claude-openrouter`, and each variant's `CLAUDE_CONFIG_DIR` is its own.
- Two variants given one `computerConfigDir` are refused at create, naming the target.

## Resume

- Built 2026-10-05 on cecc459.
- `Profile.state` and `Profile.stateScope` in `manifest.ts`, which passes the mode to `resolveNeeds`, tags each state need with its provider and answers `statesAsked`; the plugin names each volume into `MachineSpec.states` with `stateVolumeOf` in `runtime.ts`, the owner being the machine's or `root:<host>`, as `claimOf` answers it.
- Docker gets `-v <volume>:<dir>` and `--label ahpd.state=volume`; a dev container gets `--mount type=volume,...` on `up` and the label in `runArgs`.
- The label is put only on a machine with a state volume, so `state: "host"` makes exactly today's flags.
- A machine made without a profile loses its volumes in the runtime's `remove`, one `docker volume rm` per agent its label names; a profile's volumes are never removed.
- `stateVolumeOf` appends the first 8 hex of the sha256 of the unslugged pieces joined by `\0` to the readable name, so `user:a` with `b-claude` and `user:a-b` with `claude`, or `user:A` and `user:a`, get two volumes (2026-10-06).
- Claude's `computerConfigDir` defaults to `/ahpd/<provider>`.
- Tests: `computer-needs.test.ts` (8 new, the last for the two collisions), `computer-options.test.ts` (1 new), `agent-claude-presets.test.ts` (1 new), each failing before the change but the profile volume kept on remove, which guards the removal.
