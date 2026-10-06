---
title: An agent's configuration lives in a volume per profile, seeded from the host once
domain: container
status: built
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

An agent can declare a state directory with the few host files that seed it, and a machine gets that directory as a named volume per profile, owner and provider, so no two providers share a sign-in or a setting.
A profile may instead share its state volume between every owner, for a team that wants one shared bot state.
The volume is seeded from the host the first time and again only when a seed file changed, so a disposable machine pays nothing, and nothing of the host's home is mounted.
The host-home mounts stay as a profile's `state: "host"`.

## Reconnaissance

### Runtime path

```
agent.machine() { claudeState: { state: '/ahpd/<provider>', seed: [...] }, claudeConfigDirectory: { ..., when: 'host' } }
profile.state = 'volume' (default) | 'host'
profile.stateScope = 'owner' (default) | 'shared'
-> resolveNeeds keeps the needs for that mode
-> [new] identical needs of two agents collapse to one; differing ones at one target are refused
-> computer: volume ahpd-state-<profile>-<owner>-<provider>, or ahpd-state-<profile>-<provider> when shared -> seed if its stamp differs -> -v volume:/ahpd/<provider>
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
| Each provider has its own state volume, `ahpd-state-<profile>-<owner>-<provider>` (or `ahpd-state-<profile>-<provider>` when shared), named by one function, `stateVolumeOf`; variants of one plugin share no state, so a login made for one endpoint is never sent to another | Softov, 2026-10-05, asked "the built-in Claude and an OpenRouter variant share one `~/.claude` volume, credentials included: how should state volumes be keyed?": "One per provider"; it replaces the answer of 2026-10-03, "Share; dedupe identical needs", for state | 01, 02 |
| A Claude variant's configuration directory in a machine defaults to `/ahpd/<provider>` (`/ahpd/claude` for the built-in), so two variants in one machine mount two volumes at two targets; a `computerConfigDir` set alike on two variants is two differing needs at one target and is refused | (defaulted: one target cannot hold two volumes, and each variant already points `CLAUDE_CONFIG_DIR` at its own directory per exec) | 02 |
| For now two env needs, or two state needs, that are the same collapse to one at create, through one function, `sameNeed`; a clash is refused only when they differ | Softov, 2026-10-03, same answer; mounts already collapse in [`code://packages/computer/src/manifest.ts#L408-L419`](../../../../packages/computer/src/manifest.ts#L408-L419) | 05 |
| Who shares a profile's state volume is a profile setting with two values: per owner, `ahpd-state-<profile>-<owner>-<state directory>`, and shared, `ahpd-state-<profile>-<state directory>`; a bot, automation or plugin owner gets its own state as an owner, and a team that wants one shared bot state sets shared | Softov, 2026-10-04, asked "a profile's state volume is shared by every owner who makes a machine from that profile, so one person's seeded settings and agent history are another's: per profile, or per profile and owner?": "think in bots... maybe it need to be defined by the user or could be?" | 02, 04 |
| A profile's state is per owner by default | (defaulted: a person's agent history is not another's; Softov, 2026-10-04, may change it) | 02, 04 |
| The setting is the profile's `stateScope: "owner" \| "shared"`, beside `state`, and the owner in a volume name is the machine's owner as `claimOf` answers it, lowercased, with every character outside `[a-z0-9-]` written as a dash | (defaulted: `state` already sits in `Profile` and picks the mode, and a Docker volume name allows only a few characters while an owner is written `user:<id>` or `root:<host>`) | 02, 04 |
| A machine made without a profile gets `ahpd-state-<machine id>-<provider>`, named by `stateVolumeOf` and removed with it | (defaulted: nothing else would ever reuse it) | 02 |
| A seed copied in is chowned to the machine's user, and a seed whose host source is absent is skipped with a line | (defaulted: `docker cp` leaves root-owned files a non-root user cannot write; a missing seed is that seed's failure only) | 03 |
| A state volume's name is the readable name plus the first 8 hex of the sha256 of the unslugged pieces joined by `\0`, such as `ahpd-state-dev-user-a-claude-3f9c21ab`, made only by `stateVolumeOf` | Softov, 2026-10-06, asked "two different owners can land on one volume: how should names be made unique?": "Readable + short hash" | 02 |
| A seed is owned by the machine's user through the uid and gid on every archive entry, the volume root's `./` entry included, written with `docker cp -a`, and no image is pulled to chown it | Softov, 2026-10-06, asked "chown with a pulled debian image, or keep the owner written in the archive with docker cp -a?": "docker cp -a, no image" | 03 |
| A dev container that builds its own image is seeded before `up`, and after `up` its state directories are chowned to the user's ids read inside it, with `docker exec -u 0 <container> chown -R` | Softov, 2026-10-06, asked "a dev container that builds its own image has no image to read ids from before up: what should it do?": "Fix ownership after up" | 03 |
| A dev container that builds its own image is seeded after `up`, inside the running container at each state directory, with `docker cp -a`, the user's ids read there and the same stamp and link rules; no seed helper and no image is pulled for it, which replaces the chown after `up` | Softov, 2026-10-06, asked "a dev container that builds its own image pulls debian:bookworm-slim just to hold the volume while seeding: seed after up instead, through the running container, so no image is pulled?": "Seed after up, no image" | 03 |
| No seed is refused for being a login file by its name | (defaulted: which file is a login is the agent's to know; Claude's seeds in p5 task 04 name none, and a test there checks it) | 01, 03 |

## Proposed architecture

- **Data flow** - `StateNeed { state, seed: { source, target?, keep?, drop? }[] }` and `when` on any need -> resolved -> identical needs collapsed (`sameNeed`) -> `MachineSpec.states` -> volume named by `stateVolumeOf` from the provider the need came from, seed, mount.
- **Layer responsibilities** - `@ahpd/sdk`: the kind, `when`, and resolution by mode · `@ahpd/computer`: the profile field, volumes, seeding, labels.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The SDK has a state need, and a need may belong to one mode](task-01-the-sdk-has-a-state-need.md) | implemented | - |
| [02 - A profile picks the mode, and a machine gets its state volumes](task-02-a-machine-gets-its-state-volumes.md) | implemented | 01 |
| [03 - A state volume is seeded when its seed changed](task-03-a-state-volume-is-seeded.md) | implemented | 02 |
| [04 - Docs](task-04-docs.md) | implemented | 03, 05 |
| [05 - Two identical needs collapse to one](task-05-identical-needs-collapse-to-one.md) | implemented | - |

## Risks and tradeoffs

- Two variants of one plugin each get their own state, so a setting changed for one is not the other's, and each is seeded on its own; their endpoint and key reach the CLI per exec from each variant's own `env` (p5 task 09), never through the state or the container's env.
- Two machines of one owner and profile, or of one shared profile, use a state volume at once - it holds settings and keys that do not refresh, so there is nothing to race; an agent's own history in there is written by both, and each agent keys it by session.
- A person who edits a setting inside a machine loses it at the next seed of that file - the docs say to edit on the host.

## Resume state

- **Done so far:** every task built on cecc459, 2026-10-05, in the order 05, 01, 02, 03, 04, and each is `implemented`; see [implemented.md](implemented.md).
- **Next action:** Softov's review of the five tasks, and the by-hand lines of the checklist below against a real Docker.
- **Open questions:** listed in [implemented.md](implemented.md#open-questions).
- **Watch out for:**
  - plugin 16's disposable profile is the profile name for its volumes, so two disposable machines of one owner and profile, or of one shared profile, share state by design.
  - A volume is named by provider, so the built-in Claude and an OpenRouter variant of one profile and owner get `ahpd-state-<profile>-<owner>-claude` and `ahpd-state-<profile>-<owner>-claude-openrouter`; the state need carries the provider it came from, so the computer can name it.

## Final verification checklist

- [ ] A second disposable machine of one profile and owner runs no copy.
- [ ] Two owners of one profile get two state volumes, and with `stateScope: "shared"` they get one.
- [ ] Changing the host's seeded file reseeds on the next create, and a file the agent wrote survives it.
- [ ] `state: "host"` makes exactly today's machine.
- [ ] A profile naming the built-in Claude and a Claude variant makes one machine with two state volumes at `/ahpd/claude` and `/ahpd/<variant>`, and two differing needs at one target are still refused.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `docs/COMPUTER.md`, `plans/index.md` updated.
