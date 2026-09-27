---
title: A machine is made with its parts
status: todo
depends: [task-01-the-sdk-has-a-part-need.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/manifest.ts#L34-L99](../../../../packages/computer/src/manifest.ts#L34-L99) - `Profile`"
  - "[code://packages/computer/src/manifest.ts#L541-L560](../../../../packages/computer/src/manifest.ts#L541-L560) - where agents' needs are gathered"
  - "[code://packages/computer/src/runtime.ts#L56-L148](../../../../packages/computer/src/runtime.ts#L56-L148) - `MachineSpec`"
---

## Objective

A profile's `parts` and every part need are ensured with their requirements before the machine is made, and the spec carries them with their tags; the machine is labelled `ahpd.parts`.

## Files

- `UPDATE: packages/computer/src/manifest.ts` - `Profile.parts`, validated against the versions file.
- `UPDATE: packages/computer/src/runtime.ts` - `MachineSpec.parts`, the label.
- `UPDATE: packages/computer/src/plugin.ts` - ensure before `run`; refuse a session whose agent's part is not in the label.
- `UPDATE: packages/computer/test/computer-needs.test.ts` - the cases below.

## Steps

1. Gather profile parts and part needs, add every `requires`, dedupe.
2. `ensurePart` each (p3 task 03); a failed build refuses the create with the part named.
3. Label as `ahpd.parts=<id>@<version>,...`, read by name as plugin 15 task 08 reads `ahpd.agents`.
4. A part target colliding with a mount or another need is refused as any other target.
5. The machine's `PATH` is the base image's own, read from `docker image inspect`, with each part's `bin` in front, so a command named by a preset is found inside without an absolute path.

## Validation

- A profile with `parts: ["codex"]` gives a spec with `codex` and `node`.
- A session whose agent needs `gemini` on a machine labelled with `codex` only is refused, naming `gemini`.

## Resume
