---
title: A machine is made with its parts
status: implemented
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

- Built 2026-10-05. `Profile.parts` in `packages/computer/src/manifest.ts`; the plugin drops an id the versions file does not name at load, with one log line, and keeps the rest of the profile. `manifestOf` gathers the profile's parts and every resolved part need, adds what each requires (`withRequires` in `parts.ts`), checks each part's target with every other mount, and answers them as `MachineSpec.partsAsked`.
- The plugin's `made.run` builds them with `ensureParts` (`parts.ts`, over p3's `ensurePart`) before the runtime is asked; a part whose build, or whose requirement's build, fails is logged once as `<machine> is made without the part <id>: <the build's reason>` and left out. The runtime labels `ahpd.parts=<id>@<version>,...` with exactly the parts the machine got (`--label` on `docker run`, `runArgs` on a dev container).
- Refusal: the computer port answers `partsMissing(id, provider)` from the label and the provider's part needs, resolved with the machine's profile and the option; `machineRefusal` in `packages/sdk/src/computers.ts` refuses with "computer://<id> was made without the part <id>, which <provider> needs; ...". This needed an SDK port method the task's file list did not name: the plugin's `how` is never told the session's provider, and the SDK's check is the one every session road already passes through.
- `PATH`: a Docker machine gets `-e PATH=<each part's bin>:<the image's PATH>`, read with `docker image inspect --format '{{json .Config.Env}}'` after a `docker pull` when the image is not here yet, else Docker's default; a dev container's derivation (`reachOf` in `devcontainer.ts`) puts the bins in front of the probed `PATH`, read from the container's `ahpd.parts` label.
- Tests: `computer-needs.test.ts` (6 new: a profile's parts and their requirement with the label and `PATH`; an agent's part need; a gemini session refused on a codex machine; the gemini build failing beside a healthy codex, one log line, codex runs and gemini is refused; an unknown profile part; a mount at a part's target refused), `packages/sdk/test/machine-refusal.test.ts` (1 new), and `devcontainer.test.ts` "puts each part's bin in front of the probed PATH". Each failed before the change.
- Session-time machines, per Softov's answer of 2026-10-05: `manifestOf` records `sessionParts`, the parts the session's own agent (`for`) resolved, on a disposable or a `devcontainer://` spec, and `refusedWithout` in `parts.ts` is the one function that picks the failed parts a machine is not made without. The plugin's `made.run` throws "<machine> is not made, because the part <id> this session's agent needs could not be built (<reason>)" before the runtime is asked, so no container, volume or `computers.json` entry is made. A shared machine keeps the rule above. Tests in `computer-needs.test.ts`: a disposable refused with a healthy codex beside the failing gemini and nothing left in the fake Docker or `computers.json`; a session-time dev container refused with no `up` run; a disposable whose session needs codex made without the profile's failing gemini. The first two failed before the change.
