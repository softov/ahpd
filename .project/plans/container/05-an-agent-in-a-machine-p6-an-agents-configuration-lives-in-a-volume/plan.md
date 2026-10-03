---
title: An agent's configuration lives in a volume per profile, seeded from the host once
domain: container
status: planned
priority: high
created: 2026-09-26
revalidated: 2026-10-03
requires:
  - plans/container/05-an-agent-in-a-machine/plan.md
changes: []
creates: []
decisions:
  - decisions/an-agent-declares-its-machine-needs-with-a-method.md
  - decisions/the-host-hands-an-agents-machine-needs-to-the-machine-maker.md
  - decisions/a-plugin-loads-once-and-each-preset-is-a-variant.md
refs:
  - "[code://packages/sdk/src/types/machine.ts#L18-L94](../../../../packages/sdk/src/types/machine.ts#L18-L94) - the need kinds and the fields every need carries; a state need and `when` join them"
  - "[code://packages/sdk/src/machine.ts#L62-L106](../../../../packages/sdk/src/machine.ts#L62-L106) - `resolveNeeds`, which gains the mode"
  - "[code://packages/computer/src/manifest.ts#L34-L100](../../../../packages/computer/src/manifest.ts#L34-L100) - `Profile`, which gains `state`"
  - "[code://packages/computer/src/manifest.ts#L574-L592](../../../../packages/computer/src/manifest.ts#L574-L592) - each agent the profile names is resolved by its provider id"
  - "[code://packages/computer/src/runtime.ts#L736-L744](../../../../packages/computer/src/runtime.ts#L736-L744) - copy-ins between create and start, paid on every create"
  - "[code://docs/COMPUTER.md#L256](../../../../docs/COMPUTER.md#L256) - \"A copy-in is paid on every create\""
  - "[code://packages/computer/src/manifest.ts#L408-L419](../../../../packages/computer/src/manifest.ts#L408-L419) - `oneMountEach`, which already makes one entry of identical mounts"
  - "[code://packages/computer/src/manifest.ts#L689-L691](../../../../packages/computer/src/manifest.ts#L689-L691) - env needs as one object, last one wins"
  - "[code://packages/agent-claude/src/claude.ts#L373-L397](../../../../packages/agent-claude/src/claude.ts#L373-L397) - every Claude variant of one load declares identical needs"
  - https://docs.docker.com/reference/cli/docker/container/cp/ - `docker cp` into a created container's volume
---

## Goal

An agent can declare a state directory with the few host files that seed it, and a machine gets that directory as a named volume per profile and state directory, shared by the variants of one plugin that declare it.
The volume is seeded from the host the first time and again only when a seed file changed, so a disposable machine pays nothing, and nothing of the host's home is mounted.
The host-home mounts stay as a profile's `state: "host"`.

## Reconnaissance

### Runtime path

```
agent.machine() { claudeState: { state: '/ahpd/claude', seed: [...] }, claudeConfigDirectory: { ..., when: 'host' } }
profile.state = 'volume' (default) | 'host'
-> resolveNeeds keeps the needs for that mode
-> [new] identical needs of two agents collapse to one; differing ones at one target are refused
-> computer: volume ahpd-state-<profile>-ahpd-claude (named by the state directory) -> seed if its stamp differs -> -v volume:/ahpd/claude
```

### Gaps

- A copy-in is paid on every create and lost with the machine.
- The only way to share configuration without copying is mounting the host's own directory, sign-in included.
- Two env needs at one variable are last-one-wins with no refusal, and state needs have no collapse rule yet.
- `Not found: StateNeed, when, Profile.state - searched those names in packages/sdk/src and packages/computer/src.`

## Decisions locked in

| Decision | Task |
| --- | --- |
| [An agent declares what a machine needs through a machine() method](../../../decisions/an-agent-declares-its-machine-needs-with-a-method.md) | 01 |
| [The host hands an agent's machine needs to the plugin that makes the machine](../../../decisions/the-host-hands-an-agents-machine-needs-to-the-machine-maker.md) | 02 |
| [A plugin is loaded once, and each of its presets is a variant registered as an agent of its own](../../../decisions/a-plugin-loads-once-and-each-preset-is-a-variant.md) | 02 |

| What | Source | Task |
| --- | --- | --- |
| `state` defaults to `volume`; `host` is today's mounts | the proposal Softov asked to plan, 2026-09-26: the host-home mount becomes an opt-in | 02 |
| A seed overwrites only the files it names, and keeps what the agent wrote | (defaulted: transcripts and caches live beside the seeded files) | 03 |
| A seed may keep only some keys of a JSON file, or drop some by dotted path | the proposal: `.claude.json` without its account state | 03 |
| A login file is never seeded; a secret reaches the machine as an env need, from the vault or the daemon's environment | the proposal: a shared refreshing login races; Softov, 2026-10-02, asked "What does the vault unlock first?": "Options and machines" | 01, 03 |
| For now variants of one plugin share one state at the directory they declare (`/ahpd/claude` for every Claude variant); for now a volume is named `ahpd-state-<profile>-<state directory, slashes as dashes>` by one function, `stateVolumeOf`, so the naming can change | Softov, 2026-10-03, asked "where does each variant's state go, when every Claude variant declares `/ahpd/claude`?": "Share; dedupe identical needs" | 02 |
| For now two env needs, or two state needs, that are the same collapse to one at create, through one function, `sameNeed`; a clash is refused only when they differ | Softov, 2026-10-03, same answer; mounts already collapse in [`code://packages/computer/src/manifest.ts#L408-L419`](../../../../packages/computer/src/manifest.ts#L408-L419) | 05 |
| A machine made without a profile gets `ahpd-state-<machine id>-<state directory>`, named by `stateVolumeOf` and removed with it | (defaulted: nothing else would ever reuse it, and the provider is in no volume name) | 02 |
| A seed copied in is chowned to the machine's user, and a seed whose host source is absent is skipped with a line | (defaulted: `docker cp` leaves root-owned files a non-root user cannot write; a missing seed is that seed's failure only) | 03 |

## Proposed architecture

- **Data flow** - `StateNeed { state, seed: { source, target?, keep?, drop? }[] }` and `when` on any need -> resolved -> identical needs collapsed (`sameNeed`) -> `MachineSpec.states` -> volume named by `stateVolumeOf`, seed, mount.
- **Layer responsibilities** - `@ahpd/sdk`: the kind, `when`, and resolution by mode · `@ahpd/computer`: the profile field, volumes, seeding, labels.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The SDK has a state need, and a need may belong to one mode](task-01-the-sdk-has-a-state-need.md) | todo | - |
| [02 - A profile picks the mode, and a machine gets its state volumes](task-02-a-machine-gets-its-state-volumes.md) | todo | 01 |
| [03 - A state volume is seeded when its seed changed](task-03-a-state-volume-is-seeded.md) | todo | 02 |
| [04 - Docs](task-04-docs.md) | todo | 03, 05 |
| [05 - Two identical needs collapse to one](task-05-identical-needs-collapse-to-one.md) | todo | - |

## Risks and tradeoffs

- Two variants of one plugin share one state, so a setting seeded for one is the other's too; they differ by endpoint and key, which reach the CLI per exec from each variant's own `env` (p5 task 09), never through the state or the container's env.
- Two machines of one profile share a state volume at once - it holds settings and keys that do not refresh, so there is nothing to race; an agent's own history in there is written by both, and each agent keys it by session.
- A person who edits a setting inside a machine loses it at the next seed of that file - the docs say to edit on the host.

## Resume state

- **Done so far:** nothing; revalidated against main 2026-10-02.
- **Next action:** [task-05-identical-needs-collapse-to-one.md](task-05-identical-needs-collapse-to-one.md), which makes a differing env need a refusal rather than a silent last-one-wins; then [task-01-the-sdk-has-a-state-need.md](task-01-the-sdk-has-a-state-need.md).
- **Open question (ask before task 02):** a profile's state volume is shared by every owner who makes a machine from that profile, so one person's seeded settings and agent history are another's - (a) per profile, `ahpd-state-<profile>-<state directory>`, or (b) per profile and owner, `ahpd-state-<profile>-<owner>-<state directory>`?
- **Watch out for:**
  - plugin 16's disposable profile is the profile name for its volumes, so two disposable machines of one profile share state by design.
  - A volume is named by its state directory, not by provider, so the built-in Claude and an OpenRouter variant of one profile both get `ahpd-state-<profile>-ahpd-claude`; agents whose state directories differ never share a volume.

## Final verification checklist

- [ ] A second disposable machine of one profile runs no copy.
- [ ] Changing the host's seeded file reseeds on the next create, and a file the agent wrote survives it.
- [ ] `state: "host"` makes exactly today's machine.
- [ ] A profile naming the built-in Claude and a Claude variant makes one machine with one state volume, and two differing needs at one target are still refused.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `docs/COMPUTER.md`, `plans/index.md` updated.
