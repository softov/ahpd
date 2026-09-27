---
title: A profile picks the mode, and a machine gets its state volumes
status: todo
depends: [task-01-the-sdk-has-a-state-need.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/manifest.ts#L34-L99](../../../../packages/computer/src/manifest.ts#L34-L99) - `Profile`"
  - "[code://packages/computer/src/runtime.ts#L625-L650](../../../../packages/computer/src/runtime.ts#L625-L650) - the run flags"
---

## Objective

`Profile.state` is `volume` by default or `host`; in `volume` each state need becomes `-v ahpd-state-<profile>-<provider>:<state>` and the machine is labelled `ahpd.state=<mode>`.

## Files

- `UPDATE: packages/computer/src/manifest.ts` - the field and the mode passed to resolution.
- `UPDATE: packages/computer/src/runtime.ts` - `MachineSpec.states`, the flags, and `--mount type=volume` on the dev container route.
- `UPDATE: packages/computer/src/plugin.ts` - removing a machine made without a profile removes its state volumes.
- `UPDATE: packages/computer/test/computer-needs.test.ts`.

## Steps

1. Pass the mode to `resolveNeeds`.
2. Name volumes by profile and provider; without a profile, by machine id.
3. Refuse a state target that collides, as any other target.

## Validation

- Two machines of one profile mount one volume; a manifest without a profile gets its own and loses it on delete.
- `state: "host"` produces today's flags exactly.

## Resume
