---
title: An agent's configuration lives in a volume per profile, seeded from the host once
domain: container
status: planned
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/container/05-an-agent-in-a-machine/plan.md
changes: []
creates: []
decisions:
  - decisions/an-agent-declares-its-machine-needs-with-a-method.md
  - decisions/the-host-hands-an-agents-machine-needs-to-the-machine-maker.md
refs:
  - "[code://packages/sdk/src/types/machine.ts](../../../../packages/sdk/src/types/machine.ts) - the need kinds; a state need joins them"
  - "[code://packages/sdk/src/machine.ts#L62](../../../../packages/sdk/src/machine.ts#L62) - `resolveNeeds`"
  - "[code://packages/computer/src/manifest.ts#L34-L99](../../../../packages/computer/src/manifest.ts#L34-L99) - `Profile`, which gains `state`"
  - "[code://packages/computer/src/runtime.ts#L638-L660](../../../../packages/computer/src/runtime.ts#L638-L660) - copy-ins between create and start, paid on every create"
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - \"A copy-in is paid on every create\""
  - https://docs.docker.com/reference/cli/docker/container/cp/ - `docker cp` into a created container's volume
---

## Goal

An agent can declare a state directory with the few host files that seed it, and a machine gets that directory as a named volume per profile and agent.
The volume is seeded from the host the first time and again only when a seed file changed, so a disposable machine pays nothing, and nothing of the host's home is mounted.
The host-home mounts stay as a profile's `state: "host"`.

## Reconnaissance

### Runtime path

```
agent.machine() { claudeState: { state: '/ahpd/claude', seed: [...] }, claudeConfigDirectory: { ..., when: 'host' } }
profile.state = 'volume' (default) | 'host'
-> resolveNeeds keeps the needs for that mode
-> computer: volume ahpd-state-<profile>-<provider> -> seed if its stamp differs -> -v volume:/ahpd/claude
```

### Gaps

- A copy-in is paid on every create and lost with the machine.
- The only way to share configuration without copying is mounting the host's own directory, sign-in included.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [An agent declares what a machine needs through a machine() method](../../../decisions/an-agent-declares-its-machine-needs-with-a-method.md) | 01 |
| [The host hands an agent's machine needs to the plugin that makes the machine](../../../decisions/the-host-hands-an-agents-machine-needs-to-the-machine-maker.md) | 02 |

| What | Source | Task |
| --- | --- | --- |
| `state` defaults to `volume`; `host` is today's mounts | the proposal Softov asked to plan, 2026-09-26: the host-home mount becomes an opt-in | 02 |
| A seed overwrites only the files it names, and keeps what the agent wrote | (defaulted: transcripts and caches live beside the seeded files) | 03 |
| A seed may keep only some keys of a JSON file, or drop some by dotted path | the proposal: `.claude.json` without its account state | 03 |
| A refreshing login file is never seeded; the agent signs in by a secret env need | the proposal: a shared refreshing login races | 01 |
| A machine made without a profile gets `ahpd-state-<machine>-<provider>`, removed with it | (defaulted: nothing else would ever reuse it) | 02 |

## Proposed architecture

- **Data flow** - `StateNeed { state, seed: { source, target?, keep?, drop? }[] }` and `when` on any need -> resolved -> `MachineSpec.states` -> volume, seed, mount.
- **Layer responsibilities** - `@ahpd/sdk`: the kind, `when`, and resolution by mode · `@ahpd/computer`: the profile field, volumes, seeding, labels.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The SDK has a state need, and a need may belong to one mode](task-01-the-sdk-has-a-state-need.md) | todo | - |
| [02 - A profile picks the mode, and a machine gets its state volumes](task-02-a-machine-gets-its-state-volumes.md) | todo | 01 |
| [03 - A state volume is seeded when its seed changed](task-03-a-state-volume-is-seeded.md) | todo | 02 |
| [04 - Docs](task-04-docs.md) | todo | 03 |

## Risks and tradeoffs

- Two machines of one profile share a state volume at once - it holds settings and keys that do not refresh, so there is nothing to race; an agent's own history in there is written by both, and each agent keys it by session.
- A person who edits a setting inside a machine loses it at the next seed of that file - the docs say to edit on the host.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-sdk-has-a-state-need.md](task-01-the-sdk-has-a-state-need.md).
- **Open questions:** none.
- **Watch out for:** plugin 16's disposable profile is the profile name for its volumes, so two disposable machines of one profile share state by design.

## Final verification checklist

- [ ] A second disposable machine of one profile runs no copy.
- [ ] Changing the host's seeded file reseeds on the next create, and a file the agent wrote survives it.
- [ ] `state: "host"` makes exactly today's machine.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `docs/COMPUTER.md`, `plans/index.md` updated.
