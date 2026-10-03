---
title: A machine is made with its parts
status: todo
depends: [task-01-the-sdk-has-a-part-need.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/manifest.ts#L34-L100](../../../../packages/computer/src/manifest.ts#L34-L100) - `Profile`"
  - "[code://packages/computer/src/manifest.ts#L561-L605](../../../../packages/computer/src/manifest.ts#L561-L605) - where agents' needs are gathered and every target checked"
  - "[code://packages/computer/src/runtime.ts#L67-L178](../../../../packages/computer/src/runtime.ts#L67-L178) - `MachineSpec`"
  - "[code://packages/computer/src/runtime.ts#L701-L723](../../../../packages/computer/src/runtime.ts#L701-L723) - the labels a machine is made with, `ahpd.agents` and the owner, team and project ones beside it"
---

## Objective

A profile's `parts` and every part need are ensured with their requirements before the machine is made, and the spec carries the ones that were built with their tags; the machine is labelled `ahpd.parts` with the parts it has, and a part that failed to build is left out rather than refusing the machine.

## Files

- `UPDATE: packages/computer/src/manifest.ts` - `Profile.parts`, validated against the versions file.
- `UPDATE: packages/computer/src/runtime.ts` - `MachineSpec.parts`, the label.
- `UPDATE: packages/computer/src/plugin.ts` - ensure before `run`; refuse a session whose agent's part is not in the label.
- `UPDATE: packages/computer/src/devcontainer.ts` - the exec environment derivation container/03 task 18 writes puts each part's `bin` in front of the probed `PATH`.
- `UPDATE: packages/computer/test/computer-needs.test.ts` - the cases below.

## Steps

1. Gather profile parts and part needs, add every `requires`, dedupe.
2. `ensurePart` each (p3 task 03). A part whose build fails, or whose requirement's build fails, is left out of the spec with one log line naming it and the build's reason; the machine is made with the rest.
3. Label as `ahpd.parts=<id>@<version>,...` with only the parts the machine has, read by name as plugin 15 task 08 reads `ahpd.agents`. A session whose agent needs a part the label lacks is refused with a sentence naming the part, and every other session on the machine runs.
4. A part target colliding with a mount or another need is refused as any other target.
5. The machine's `PATH` has each part's `bin` in front, so a command named by a preset is found inside without an absolute path. For a Docker machine, the base is the image's own `PATH`, read from `docker image inspect`, set at `docker run`. For a dev container, every exec passes the probed `PATH` as `-e PATH=...` (container/03 task 18), which would override a `PATH` set at create, so the parts' `bin`s are prepended to the probed `PATH` inside that derivation.

## Validation

- A profile with `parts: ["codex"]` gives a spec with `codex` and `node`.
- A session whose agent needs `gemini` on a machine labelled with `codex` only is refused, naming `gemini`.
- With the fake Docker failing the build of `ahpd-part/gemini`, a profile with `parts: ["codex", "gemini"]` makes a machine labelled `codex` and `node` only, logs one line naming `gemini`, runs a codex session and refuses a gemini one naming `gemini`.
- `devcontainer.test.ts`: an exec into a dev container with the `codex` part has `-e PATH=/opt/ahpd/codex/bin:/opt/ahpd/node/bin:<probed PATH>`.

## Resume
