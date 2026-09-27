---
title: A part is mounted into a machine, from its image or from a volume
domain: container
status: planned
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/container/05-an-agent-in-a-machine-p3-parts-are-built-from-one-versions-file/plan.md
changes: []
creates: []
decisions:
  - decisions/a-part-is-mounted-from-its-image-and-a-volume-is-the-fallback.md
  - decisions/a-need-and-a-mount-at-one-target-are-refused.md
refs:
  - "[code://packages/sdk/src/types/machine.ts](../../../../packages/sdk/src/types/machine.ts) - `MachineNeed`, `NeedKind`, `ResolvedNeed`, where a fifth kind goes"
  - "[code://packages/sdk/src/machine.ts#L62](../../../../packages/sdk/src/machine.ts#L62) - `resolveNeeds`"
  - "[code://packages/computer/src/manifest.ts#L34-L99](../../../../packages/computer/src/manifest.ts#L34-L99) - `Profile`, which gains `parts`"
  - "[code://packages/computer/src/runtime.ts#L56-L148](../../../../packages/computer/src/runtime.ts#L56-L148) - `MachineSpec`, which gains `parts`"
  - "[code://packages/computer/src/runtime.ts#L625-L650](../../../../packages/computer/src/runtime.ts#L625-L650) - the docker run flags"
  - "[code://packages/computer/src/runtime.ts#L570-L600](../../../../packages/computer/src/runtime.ts#L570-L600) - `devcontainer up`, where a copy-in already becomes a mount"
  - https://docs.docker.com/engine/storage/ - `--mount type=image` and `image-subpath`
---

## Goal

An agent can say it needs a part, a profile can name the parts a long-lived machine carries, and the machine is made with each part and its requirements mounted read-only at `/opt/ahpd/<part>`.
A runtime that refuses image mounts gets the same part from a volume filled once.

## Reconnaissance

### Searches performed

- `rg "type=image" packages` - nothing.
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

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A part is mounted from its own image, and a volume filled from that image is the fallback](../../../decisions/a-part-is-mounted-from-its-image-and-a-volume-is-the-fallback.md) | 03, 04 |
| [A need and a mount at one target are refused at create](../../../decisions/a-need-and-a-mount-at-one-target-are-refused.md) | 02 |

| What | Source | Task |
| --- | --- | --- |
| A part's target is always `/opt/ahpd/<part>`, never chosen by the agent | the joined image puts it there, so both routes agree | 01 |
| Whether image mounts work is probed once per daemon and kept | (defaulted: the answer does not change while Docker runs) | 03 |
| A dev container gets parts by volume only | the Dev Container CLI's `--mount` takes bind and volume | 05 |
| A running machine never gains a part; a session whose part is missing is refused, naming it | the rule that a machine is kept to the agents it was prepared for | 02 |

## Proposed architecture

- **Data flow** - need -> resolved part -> `MachineSpec.parts: { id, tag, version }[]` -> runtime flags.
- **Layer responsibilities** - `@ahpd/sdk`: the kind and its resolution · `@ahpd/computer`: ensuring, probing, flags, the volume, the label.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The SDK has a part need](task-01-the-sdk-has-a-part-need.md) | todo | - |
| [02 - A machine is made with its parts](task-02-a-machine-is-made-with-its-parts.md) | todo | 01 |
| [03 - Docker mounts a part from its image](task-03-docker-mounts-a-part-from-its-image.md) | todo | 02 |
| [04 - A volume is the fallback](task-04-a-volume-is-the-fallback.md) | todo | 03 |
| [05 - A dev container gets its parts by volume](task-05-a-dev-container-gets-its-parts-by-volume.md) | todo | 04 |
| [06 - Docs](task-06-docs.md) | todo | 05 |

## Risks and tradeoffs

- The image mount is experimental and prints a warning on stderr - the runtime does not treat that line as a failure.
- A volume filled from an old version stays - the volume name carries the version, so a bump makes a new one and the old one is left for `docker volume prune`.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-sdk-has-a-part-need.md](task-01-the-sdk-has-a-part-need.md).
- **Open questions:** none.
- **Watch out for:** plugin 15's task 09 checks every mount target at create; a part's target joins that check.

## Final verification checklist

- [ ] A disposable machine for an agent that needs `codex` has `/opt/ahpd/codex` and `/opt/ahpd/node`, read-only, and nothing else of ours.
- [ ] With image mounts switched off in the fake, the same machine gets both from volumes.
- [ ] A session on a long-lived machine without its part is refused with the part named.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `docs/COMPUTER.md`, `plans/index.md` updated.
