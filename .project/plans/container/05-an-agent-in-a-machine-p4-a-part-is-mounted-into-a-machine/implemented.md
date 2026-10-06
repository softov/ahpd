---
title: A part is mounted into a machine, from its image or from a volume - implemented
date: 2026-10-05
refs:
  - git://2caabb1
  - "[code://packages/sdk/src/types/machine.ts](../../../../packages/sdk/src/types/machine.ts) - `PartNeed` and the `part` kind"
  - "[code://packages/sdk/src/machine.ts](../../../../packages/sdk/src/machine.ts) - a part need resolved to `/opt/ahpd/<id>`"
  - "[code://packages/sdk/src/computers.ts](../../../../packages/sdk/src/computers.ts) - `machineRefusal` naming a missing part"
  - "[code://packages/computer/src/parts.ts](../../../../packages/computer/src/parts.ts) - `ensureParts`, `withRequires`, the label, the volume name and the `PATH`"
  - "[code://packages/computer/src/manifest.ts](../../../../packages/computer/src/manifest.ts) - `Profile.parts` and the parts a machine asks for"
  - "[code://packages/computer/src/runtime.ts](../../../../packages/computer/src/runtime.ts) - the probe, the two routes, the volume fill and the dev container override"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - building before a machine is made, `partsMissing`, `imageMounts`"
  - "[code://packages/computer/src/devcontainer.ts](../../../../packages/computer/src/devcontainer.ts) - each part's `bin` in front of the probed `PATH`"
---

An agent can say it needs a part, a profile can name the parts its machines carry, and a machine is made with each part and what it requires mounted read-only at `/opt/ahpd/<id>`: from the part's own image where Docker takes an image mount, from a volume filled once from that image where it does not. The machine is labelled `ahpd.parts` with the parts it has and its `PATH` puts each one's `bin` first. A part that will not build is left out, and only a session whose agent needs it is refused, naming it; a machine made for one session is instead refused at create when that session's own part fails, and nothing is made.

## What was built

- [`code://packages/sdk/src/types/machine.ts`](../../../../packages/sdk/src/types/machine.ts) and [`code://packages/sdk/src/machine.ts`](../../../../packages/sdk/src/machine.ts) - `PartNeed { part }`, the `part` kind, and its resolution to `/opt/ahpd/<id>` with a profile's or option's value naming another part; a part id that is not a plain name is refused.
- [`code://packages/sdk/src/types/computers.ts`](../../../../packages/sdk/src/types/computers.ts) and [`code://packages/sdk/src/computers.ts`](../../../../packages/sdk/src/computers.ts) - `ComputerPort.partsMissing`, and `machineRefusal` refusing a session whose agent needs a part the machine lacks.
- [`code://packages/computer/src/parts.ts`](../../../../packages/computer/src/parts.ts) - `ensureParts`, which builds each part asked for with its requirements and answers the ones that failed with the build's reason; `refusedWithout`, the one place that decides which failed parts a machine is not made without (a session-time machine's own agent's parts); `MACHINE_PARTS`, `volumeOf`, `pathWith`, `archiveOf`, and `once` shared with the volume fill.
- [`code://packages/computer/src/manifest.ts`](../../../../packages/computer/src/manifest.ts) - `Profile.parts`, and `partsAsked` from the profile and every part need, each part's target in the shared-target check.
- [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts) - `canMountImages`, `devcontainerPartRoute`, `ensurePartVolume` with its marker, the flags and label on `docker run`, the image's `PATH`, and the override config's `runArgs` or `mounts` for a dev container.
- [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) - parts built before every machine is made, an unknown profile part dropped at load, the `imageMounts` option, and `partsMissing`.
- [`code://packages/computer/src/devcontainer.ts`](../../../../packages/computer/src/devcontainer.ts) - `reachOf` puts the label's parts in front of the probed `PATH`.
- `test/fixtures/docker.mjs` and `test/fixtures/devcontainer.mjs` - image mounts taken or refused, `pull`, named volumes filled at create, `cp` in and out of a volume, and an image mount in `runArgs`.
- `docs/COMPUTER.md` - `parts` in Profiles, and "Parts in a machine".

## Verified

- `packages/sdk/test/machine-needs.test.ts` (1 new), `packages/sdk/test/machine-refusal.test.ts` (1 new), `packages/computer/test/computer-needs.test.ts` (9 new, three of them the session-time refusal: a disposable and a `devcontainer://` refused leaving nothing in the fake Docker or `computers.json`, and a session machine made without a failed part its agent does not need), `packages/computer/test/computer-parts-mount.test.ts` (6, new file) and `packages/computer/test/devcontainer.test.ts` (3 new), each failing before its change. The failed build is tested beside a healthy part: gemini fails, codex and node are mounted, one log line names gemini, a codex session runs and a gemini one is refused.
- Docker 29.6.2 and `@devcontainers/cli` 0.89.0 on 2026-10-05, through the built runtime: a `debian:bookworm-slim` machine and a dev container, each by the image route and the volume route, found `codex-acp` at `/opt/ahpd/codex/bin/codex-acp` on the `PATH`, ran Node 24.21.0, and refused a write under `/opt/ahpd/codex`. `docker create` alone filled a part volume from its `FROM scratch` image. Nothing was left behind.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (213 files, 2966 tests) and `pnpm build` green.

## Departures from the plan

- The refusal needed an SDK port method, `partsMissing`, which task 02's file list did not name: the plugin's `how` is not told the session's provider, and `machineRefusal` is the check every session road passes.
- The fakes' switches are state-file fields (`imageMounts`, `failMount`, `failVolume`, `failPull`), as `failBuild` and `failRun` are, not an environment variable.
- The marker is read and written with `docker cp` through a helper created from the part image and never started, and written as a one-file tar on stdin.
- The image's `PATH` is read after a `docker pull` when the image is not here yet.
- Added from the rule that one broken part never takes the machine down: a part whose volume cannot be filled is left out, with what requires it; and a part id that is not a plain name is refused.
- `codex-acp --help` waits on stdin as an ACP server, so the by-hand checks used `command -v codex-acp` and Node.
- Task 05's line refs had moved; the code is `overrideOf` and the dev container branch of `run`.

## Left for later

- Parts are built inside the create turn, so a first build holds other creates on the runtime until it ends.
- The disposable-machine line of the checklist and Softov's own Docker checks are not run by this build.
- The tasks stay `implemented` until Softov reviews them.
