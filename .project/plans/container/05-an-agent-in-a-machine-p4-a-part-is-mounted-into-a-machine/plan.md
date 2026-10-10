---
title: A part is mounted into a machine, from its image or from a volume
domain: container
status: built
priority: high
created: 2026-09-26
revalidated: 2026-10-03
requires:
  - plans/container/05-an-agent-in-a-machine-p3-parts-are-built-from-one-versions-file/plan.md
  - plans/plugin/15-an-agent-says-what-a-machine-needs/plan.md
  - plans/container/03-a-dev-container-is-a-computer/plan.md
changes: []
creates: []
decisions:
  - decisions/a-part-is-mounted-from-its-image-and-a-volume-is-the-fallback.md
  - decisions/a-shared-target-is-refused-only-when-the-mounts-differ.md
  - decisions/a-dev-container-is-reached-by-docker-exec.md
refs:
  - "[code://packages/sdk/src/types/machine.ts#L74-L94](../../../../packages/sdk/src/types/machine.ts#L74-L94) - `MachineNeed`, `NeedKind` (four kinds) and `ResolvedNeed`, where a fifth kind goes"
  - "[code://packages/sdk/src/machine.ts#L62-L106](../../../../packages/sdk/src/machine.ts#L62-L106) - `resolveNeeds`"
  - "[code://packages/computer/src/manifest.ts#L34-L100](../../../../packages/computer/src/manifest.ts#L34-L100) - `Profile`, which gains `parts`"
  - "[code://packages/computer/src/manifest.ts#L561-L605](../../../../packages/computer/src/manifest.ts#L561-L605) - where agents' needs are gathered (`resolveNeeds` at L585) and every target is checked once"
  - "[code://packages/computer/src/runtime.ts#L67-L178](../../../../packages/computer/src/runtime.ts#L67-L178) - `MachineSpec`, which gains `parts`"
  - "[code://packages/computer/src/runtime.ts#L697-L746](../../../../packages/computer/src/runtime.ts#L697-L746) - the docker run flags"
  - "[code://packages/computer/src/runtime.ts#L656-L697](../../../../packages/computer/src/runtime.ts#L656-L697) - `devcontainer up`, where a copy-in already becomes a mount"
  - https://docs.docker.com/engine/storage/ - `--mount type=image` and `image-subpath`
---

## Goal

An agent can say it needs a part, a profile can name the parts a long-lived machine carries, and the machine is made with each part and its requirements mounted read-only at `/opt/ahpd/<part>`.
A runtime that refuses image mounts gets the same part from a volume filled once.

## Reconnaissance

### Searches performed

- `rg "type=image|PartNeed|parts" packages/sdk/src packages/computer/src` - nothing; the need kinds are still four (`types/machine.ts:74-78`).
- Docker 29.6.2 on this workstation mounts `node:22` into `debian:bookworm-slim` with `type=image,image-subpath=usr/local`, read-only, with an experimental warning (2026-09-26).

### Runtime path

```
agent.machine() { codex: { part: 'codex' } } + profile.parts
-> resolveNeeds -> ResolvedNeed { kind: 'part', source: 'codex', target: '/opt/ahpd/codex' }
-> computer: ensurePart + requires -> tags
-> docker run --mount type=image,source=<tag>,image-subpath=opt/ahpd/codex,target=/opt/ahpd/codex,readonly
   | fallback: -v ahpd-part-codex-<version>:/opt/ahpd/codex:ro
-> label ahpd.parts=codex@<version>,node@<version>
```

### Gaps

- No need kind names an image.
- The runtime cannot tell whether it may mount an image.
- `devcontainer up` turns every mount into `--mount type=bind` (`runtime.ts:494-500`), which has no image form.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A part is mounted from its own image, and a volume filled from that image is the fallback](../../../decisions/a-part-is-mounted-from-its-image-and-a-volume-is-the-fallback.md) | 03, 04 |
| [A shared target is refused at create only when what lands there differs](../../../decisions/a-shared-target-is-refused-only-when-the-mounts-differ.md) | 02 |
| [A dev container is made by the Dev Container CLI and reached by docker exec](../../../decisions/a-dev-container-is-reached-by-docker-exec.md) | 05 |

| What | Source | Task |
| --- | --- | --- |
| A part's target is always `/opt/ahpd/<part>`, never chosen by the agent | the joined image puts it there, so both routes agree | 01 |
| Whether image mounts work is probed with the part being mounted, after it is ensured, and only an answer about the mount type is kept for the daemon's life | (defaulted: the mount type's answer does not change while Docker runs, and a missing image says nothing about it) | 03 |
| A part whose build fails is left out of the machine, which is labelled with the parts it has; only a session needing the missing part is refused | Softov, 2026-10-03, asked "when a `$secret` in a plugin's options can't be read at load, what fails?": "Only its item" (a failure belongs to the item that failed) | 02 |
| For now, a machine made for one session (a disposable, or a dev container) is refused at create, naming the part, when a part that session needs fails to build; a shared machine is still made without it | Softov, 2026-10-05, asked "a machine made for one session is still created when that session's own part fails to build, and the session is then refused: refuse before the machine is made instead?": "I dont want to decide it as a rule, but for now refuse at create. in a future, some parts are desired, some are mandatory"; the split is the idea [a-part-is-desired-or-mandatory](../../../ideas/a-part-is-desired-or-mandatory.md) | 02 |
| A part volume is filled first and marked filled last, by a marker file; one without the marker is filled again | (defaulted: "present means filled" would keep a half-filled volume for ever) | 04 |
| Whether a real Docker fills a volume from a scratch image at create is checked by hand, and the build keeps the fake | (defaulted: the build agent has no Docker) | 04 |
| A dev container's parts reach `PATH` by being prepended to the probed `PATH` in container/03 task 18's exec derivation | (defaulted: the probed `PATH` is passed as `-e` on every exec and would override one set at create) | 02 |
| A running machine never gains a part; a session whose part is missing is refused, naming it | the rule that a machine is kept to the agents it was prepared for | 02 |
| For now a dev container's image mount is a `--mount type=image,...` entry in the override config's `runArgs`, checked against a real CLI first; where that fails, the volume route; the route is chosen in one function beside the Docker probe, so it can change | Softov, 2026-10-03, asked "how does `devcontainer up` take an image mount?": "a `--mount type=image` entry in the override config's runArgs, checked against a real CLI first; where that fails, the volume route" | 05 |

## Proposed architecture

- **Data flow** - need -> resolved part -> `MachineSpec.parts: { id, tag, version }[]` -> runtime flags.
- **Layer responsibilities** - `@ahpd/sdk`: the kind and its resolution · `@ahpd/computer`: ensuring, probing, flags, the volume, the label.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The SDK has a part need](task-01-the-sdk-has-a-part-need.md) | done | - |
| [02 - A machine is made with its parts](task-02-a-machine-is-made-with-its-parts.md) | done | 01 |
| [03 - Docker mounts a part from its image](task-03-docker-mounts-a-part-from-its-image.md) | done | 02 |
| [04 - A volume is the fallback](task-04-a-volume-is-the-fallback.md) | done | 03 |
| [05 - A dev container gets its parts as a Docker machine does](task-05-a-dev-container-gets-its-parts-by-volume.md) | done | 04 |
| [06 - Docs](task-06-docs.md) | done | 05 |

## Risks and tradeoffs

- The image mount is experimental and prints a warning on stderr - the runtime does not treat that line as a failure.
- A volume filled from an old version stays - the volume name carries the version, so a bump makes a new one and the old one is left for `docker volume prune`.

## Resume state

- **Done so far:** every task built on 2caabb1, 2026-10-05, and each is `done`; see [implemented.md](implemented.md). The image and volume routes were run against Docker 29.6.2 and `@devcontainers/cli` 0.89.0 through the built runtime. A machine made for one session is refused at create when that session's part fails to build, as the answer table says, decided in `refusedWithout`.
- **Next action:** the by-hand checklist items only. Every task was reviewed against main on 2026-10-10 and is `done`; the work is in `cecc459`.
- **Open questions:** none; the session-time question is answered in the table above (Softov, 2026-10-05).
- **Watch out for:**
  - plugin 15's task 09 checks every mount target at create; a part's target joins that check.

## Final verification checklist

- [ ] A disposable machine for an agent that needs `codex` has `/opt/ahpd/codex` and `/opt/ahpd/node`, read-only, and nothing else of ours.
- [x] With image mounts switched off in the fake, the same machine gets both from volumes.
- [x] A session on a long-lived machine without its part is refused with the part named.
- [x] A part whose build fails leaves the machine made without it, and only sessions needing it are refused.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [x] `docs/COMPUTER.md`, `plans/index.md` updated.
