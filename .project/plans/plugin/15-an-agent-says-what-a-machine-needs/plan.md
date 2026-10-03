---
title: An agent says what a machine needs, and the machine is made with it
domain: plugin
status: active
priority: high
created: 2026-09-26
revalidated: 2026-10-03
requires:
  - plans/plugin/11-a-session-inside-a-computer/plan.md
changes: []
creates: []
decisions:
  - decisions/an-agent-declares-its-machine-needs-with-a-method.md
  - decisions/the-host-hands-an-agents-machine-needs-to-the-machine-maker.md
  - decisions/cofold-config-reaches-a-machine-at-a-fixed-target.md
  - decisions/a-session-on-a-machine-not-prepared-for-its-agent-fails-at-creation.md
  - decisions/a-shared-target-is-refused-only-when-the-mounts-differ.md
refs:
  - "[code://packages/sdk/src/types/agent.ts#L335-L353](../../../../packages/sdk/src/types/agent.ts#L335-L353) - `schema()`, `defaults()` and `machine?()` beside them"
  - "[code://packages/sdk/src/types/machine.ts](../../../../packages/sdk/src/types/machine.ts) - `MachineNeed` and `ResolvedNeed`"
  - "[code://packages/sdk/src/machine.ts#L62-L106](../../../../packages/sdk/src/machine.ts#L62-L106) - `resolveNeeds`: profile, then plugin option, then the agent's default"
  - "[code://packages/sdk/src/plugins.ts#L325-L328](../../../../packages/sdk/src/plugins.ts#L325-L328) - `PluginHost.machineNeeds`, read from the live agent list"
  - "[code://packages/sdk/src/types/computers.ts#L118-L178](../../../../packages/sdk/src/types/computers.ts#L118-L178) - `ComputerPort`, with `agents?` read back from the label"
  - "[code://packages/sdk/src/computers.ts#L103-L130](../../../../packages/sdk/src/computers.ts#L103-L130) - `computersFor`, the port check on `how` and `nested`"
  - "[code://packages/computer/src/manifest.ts#L520-L621](../../../../packages/computer/src/manifest.ts#L520-L621) - mounts, folder, needs, the needs-only target check and the mount order"
  - "[code://packages/computer/src/runtime.ts#L527-L549](../../../../packages/computer/src/runtime.ts#L527-L549) - the listing's label readers, which split the `Labels` column on commas"
  - "[code://packages/computer/src/runtime.ts#L645-L746](../../../../packages/computer/src/runtime.ts#L645-L746) - `run`: the dev container route and the Docker flags"
  - "[code://packages/computer/src/plugin.ts#L903-L970](../../../../packages/computer/src/plugin.ts#L903-L970) - the `computer` key and its picker"
  - "[code://packages/agent-claude/src/claude.ts#L373-L398](../../../../packages/agent-claude/src/claude.ts#L373-L398) - Claude's `machine()`, the pattern cofold copies"
  - "[code://packages/agent-cofold/src/agent.ts#L553-L572](../../../../packages/agent-cofold/src/agent.ts#L553-L572) - cofold's `machine()`, which mounts at the host's own path"
  - "[code://packages/sdk/src/host.ts#L8676-L8692](../../../../packages/sdk/src/host.ts#L8676-L8692) - `createSession`: the policy check, then `placedIn`"
  - "[code://docs/COMPUTER.md#L171-L224](../../../../docs/COMPUTER.md#L171-L224) - Claude in a machine and profiles"
  - "git://7552054:.project/ideas/an-agent-says-what-a-machine-needs.md - the idea, with what Softov settled"
---

## Goal

A computer profile names the agents it prepares a machine for, and the machine is made with what each agent says it needs: Claude's config and CLI, cofold's config.
A mount whose host path is missing or relative is refused when the machine is made, two mounts at one target are refused, and a session never pairs an agent with a machine not prepared for it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Runtime path

```
profile { agents: ['claude'] } -> create -> host.machineNeeds('claude') -> agent.machine()
  -> resolveNeeds: profile value, then plugin option, then the agent's default -> refuse a missing host path
  -> [new] refuse a relative path, a missing mount source, two mounts at one target
  -> docker: -v / -e, then docker cp for copy-in; label ahpd.agents=claude
picker for provider X -> only machines labelled with X -> [new] label read by name, so claude,cofold lists both
createSession / pre-turn restart / automation onto a machine without X -> [new] refused at creation; the port check stays
```

### Gaps

- `labelsListed` splits the `docker ps` `Labels` column on commas, so `ahpd.agents=claude,cofold` loses cofold, and the owner, team, project and dev container folder are read the same way.
- The target check compares needs only with each other; a profile mount, a body mount, a plugin mount and the session folder can share a target, and the fake Docker accepts the duplicate.
- A need value is never checked to be absolute, and a profile, plugin or body mount source is never checked to exist.
- The wrong-machine refusal fires only when the backend enters the machine, after the session exists.
- cofold mounts its config at the host's own path, which a container user with another home never reads.

## Decisions locked in

| Decision | Source | Task |
| --- | --- | --- |
| [An agent declares what a machine needs through a machine() method](../../../decisions/an-agent-declares-its-machine-needs-with-a-method.md) | Softov, 2026-09-26 | 01, 05, 06 |
| [The host hands an agent's machine needs to the plugin that makes the machine](../../../decisions/the-host-hands-an-agents-machine-needs-to-the-machine-maker.md) | Softov, 2026-09-26 | 02, 03, 04 |
| [Cofold's configuration reaches a machine at a fixed target](../../../decisions/cofold-config-reaches-a-machine-at-a-fixed-target.md) | Softov, 2026-09-26 | 06 |
| [A session on a machine not prepared for its agent fails at creation](../../../decisions/a-session-on-a-machine-not-prepared-for-its-agent-fails-at-creation.md) | Softov, 2026-09-26 | 11 |
| [A shared target is refused at create only when what lands there differs](../../../decisions/a-shared-target-is-refused-only-when-the-mounts-differ.md) | Softov, 2026-09-26 and 2026-10-03 | 09 |

| What | Source | Task |
| --- | --- | --- |
| Delivery kinds: mount, env and copy-in, all three | Softov, 2026-09-26: "All three" | 01, 03 |
| A need is filled from the profile, then the plugin option, then the agent's default | the idea, settled by Softov | 02 |
| Defaults come from the host user's folder; the docs warn that it is shared | the idea, settled by Softov | 05, 07 |
| Same-path mounts for the session folder, so Claude's history is one list | Softov: "Same-path mounts for now" | 03 |
| Claude's executable default is what `~/.local/bin/claude` points at | the 127 found on 2026-09-26 | 05 |
| Disposable machines are their own plan | Softov: "Their own plan, right after" (`plugin/16`) | - |
| A need value is an absolute path, and every mount source is checked at create | the review of 2026-09-26: a relative value became a named volume | 10 |
| Labels are read from `docker ps` by name, never by splitting the `Labels` column | the review of 2026-09-26: `ahpd.agents=claude,cofold` lost cofold | 08 |
| `computerConfigDir` on cofold is declared in its `optionsSchema` exactly as Claude's is | [`code://packages/agent-claude/src/plugin.ts#L41-L44`](../../../../packages/agent-claude/src/plugin.ts#L41-L44); the daemon checks a plugin's options against its schema and warns on a key it does not know ([`code://packages/server/src/plugins.ts#L521-L533`](../../../../packages/server/src/plugins.ts#L521-L533)) | 06 |
| A need value, and an env need's above all, is never printed in a refusal or a log | a need may carry a credential (the vault's `$secret` values, `container/05-p1`) | 10, 12 |
| `createSession`, the pre-turn change and an automation's start run the policy check first and the wrong-machine label check after it, in one place each so the order can change | Softov, 2026-10-03, asked "is the wrong-machine check made before or after the policy check?": "policy check first, then the wrong-machine label check" | 11 |

## Proposed architecture

- **Data flow** - `Agent.machine()` -> `PluginHost.machineNeeds` -> `resolveNeeds` -> `manifestOf` (one list of every mount with its origin, checked once) -> `MachineSpec` -> runtime flags and labels.
- **State flow** - the machine's labels are the only record: `ahpd.agents` (read by name), owner, team, project, dev container folder, disposable profile.
- **Layer responsibilities** - sdk: the need types, resolution, the one "may this session run on this machine" reader the host and `computersFor` share · computer: the manifest checks, the runtime's labels and flags, the fake Docker · agent-claude, agent-cofold: `machine()` and `computerConfigDir`.
- **Source-of-truth files** - [`code://packages/sdk/src/machine.ts`](../../../../packages/sdk/src/machine.ts), [`code://packages/computer/src/manifest.ts`](../../../../packages/computer/src/manifest.ts), [`code://packages/sdk/src/computers.ts`](../../../../packages/sdk/src/computers.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The SDK has machine() and the need type](task-01-the-need-type.md) | implemented | - |
| [02 - The host resolves an agent's needs for a machine maker](task-02-the-host-resolves-needs.md) | implemented | 01 |
| [03 - Docker makes a machine from resolved needs](task-03-docker-applies-needs.md) | implemented | 02 |
| [04 - The picker and the host keep an agent to its machines](task-04-agents-kept-to-their-machines.md) | implemented | 03 |
| [05 - Claude declares its needs](task-05-claude-declares.md) | implemented | 01 |
| [06 - Cofold declares its needs, at a fixed target like Claude's](task-06-cofold-declares.md) | todo | 01 |
| [07 - Docs](task-07-docs.md) | implemented | 04, 05, 06 |
| [08 - Every label a listing reads is read by name](task-08-a-label-naming-two-agents-is-read-whole.md) | todo | - |
| [09 - Every mount target is checked at create](task-09-every-mount-target-is-checked-at-create.md) | todo | - |
| [10 - A path a machine is made with is absolute and there](task-10-a-path-a-machine-is-made-with-is-absolute-and-there.md) | todo | - |
| [11 - A session on the wrong machine fails at creation](task-11-a-session-on-the-wrong-machine-fails-at-creation.md) | todo | - |
| [12 - The docs cover every need, and the comments document](task-12-docs-and-comments.md) | todo | 06, 09, 10 |

## Risks and tradeoffs

- A shared `~/.claude` in a company is one sign-in for everyone; the docs say so until per-person isolation exists.
- Copy-in is paid on every create and loses what the agent writes there when the machine goes.
- Checking that every mount source exists breaks any test or config that names a path this host does not have, such as `/srv/claude-home`; tests move to temporary directories.
- A relative mount source is refused, so a Docker named volume in `mounts` stops working; nothing in the docs or tests uses one, and `container/05-p6` brings volumes as their own field.
- `XDG_CONFIG_HOME` set for cofold is read by the nested `ahpd` too, so its own config folder moves under `/ahpd/cofold/ahpd`; task 06 checks the nested host still starts.

## Resume state

- **Done so far:** tasks 01 to 05 and 07 implemented on 2026-09-26 and reviewed the same day; their code is on main as of 2026-10-02.
- **Next action:** [task-08-a-label-naming-two-agents-is-read-whole.md](task-08-a-label-naming-two-agents-is-read-whole.md), because `container/03` task 11 and `plugin/16` task 07 read labels through it; then 09, 10 and 11 in any order, then 06, then 12.
- **Open questions:** none.
- **Watch out for:** an existing profile with hand-written `mounts` and no `agents` is unchanged; a create body may name `folder` only with `bodyMounts`; `machineNeeds` is read at create time and is deliberately empty while plugins load; the fake Docker accepted what real Docker refuses, so a fix here changes the fake first; `container/05-p1` moves env values out of argv and the vault adds `$secret` need values, neither of which is this plan's work, but no task here may print a need value; `plugin/16` task 08 extends the reader task 11 writes with the `disposableAlone` rule.

## Final verification checklist

- [ ] A profile with `agents: ["claude"]` and no mounts makes a machine a Claude session runs in, on this host's sign-in.
- [ ] A profile whose need points at a missing or relative path is refused at create, with the need's name in the sentence and no env value printed.
- [ ] A profile, plugin or body mount whose host path is missing or relative is refused at create.
- [ ] The picker for cofold does not offer a machine prepared only for Claude, and a profile naming `claude` and `cofold` is offered in both pickers.
- [ ] A listed machine's owner, team, project and dev container folder read back whole when a value holds a comma.
- [ ] A profile mount and a need at one target are refused at create, with both named, on the Docker and the dev container routes, and the docs' `scratch` example works for a Claude session.
- [ ] A cofold session in a machine whose image runs as another user finds its configuration at `/ahpd/cofold/cofold/config.json`.
- [ ] `createSession`, a pre-turn restart and an automation start onto a machine not prepared for the agent fail at creation with the sentence, and a machine refused by policy answers the policy's sentence instead.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `docs/COMPUTER.md`, `docs/PLUGINS.md`, `plans/index.md` updated.
