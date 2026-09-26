---
title: An agent says what a machine needs, and the machine is made with it
domain: plugin
status: planned
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/plugin/11-a-session-inside-a-computer/plan.md
changes: []
creates: []
decisions:
  - decisions/an-agent-declares-its-machine-needs-with-a-method.md
  - decisions/the-host-hands-an-agents-machine-needs-to-the-machine-maker.md
refs:
  - "[code://packages/sdk/src/types/agent.ts#L275-L283](../../../../packages/sdk/src/types/agent.ts#L275-L283) - `schema()` and `defaults()`, where `machine()` goes beside them"
  - "[code://packages/sdk/src/types/computers.ts#L47-L49](../../../../packages/sdk/src/types/computers.ts#L47-L49) - `ComputerPort`"
  - "[code://packages/sdk/src/types/completions.ts#L27](../../../../packages/sdk/src/types/completions.ts#L27) - the answerer is told the `provider`"
  - "[code://packages/computer/src/plugin.ts#L297-L321](../../../../packages/computer/src/plugin.ts#L297-L321) - the `computer` key and its picker"
  - "[code://packages/computer/src/runtime.ts#L272](../../../../packages/computer/src/runtime.ts#L272) - Docker, the runtime that turns needs into flags"
  - "[code://packages/agent-claude/src/claude.ts#L372-L395](../../../../packages/agent-claude/src/claude.ts#L372-L395) - where Claude's history lives, keyed by the working directory"
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - the profile example with the pinned `versions/2.1.267` path"
  - "[code://.project/ideas/an-agent-says-what-a-machine-needs.md](../../../ideas/an-agent-says-what-a-machine-needs.md) - the idea, with what Softov settled"
---

## Goal

A computer profile names the agents it prepares a machine for, and the machine is made with what each agent says it needs: Claude's config and CLI, cofold's config.
A mount whose host path is missing is refused when the machine is made, and a session never pairs an agent with a machine not prepared for it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Runtime path

```
profile { agents: ['claude'] } -> create -> [new] host.machineNeeds('claude') -> agent.machine()
  -> [new] resolve: profile value, then plugin option, then the agent's default -> refuse a missing host path
  -> docker: -v / -e, then docker cp for copy-in -> [new] label ahpd.agents=claude
picker for provider X -> [new] only machines labelled with X
session on a machine without X -> [new] refused with a sentence
```

### Gaps

- `Agent` has no `machine()`; the needs live as mounts in the computer plugin's profiles.
- A missing mount source becomes an empty directory, and the session exits 127.
- The picker offers every machine for every agent.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [An agent declares what a machine needs through a machine() method](../../../decisions/an-agent-declares-its-machine-needs-with-a-method.md) | 01, 05, 06 |
| [The host hands an agent's machine needs to the plugin that makes the machine](../../../decisions/the-host-hands-an-agents-machine-needs-to-the-machine-maker.md) | 02, 03, 04 |

| What | Source | Task |
| --- | --- | --- |
| Delivery kinds: mount, env and copy-in, all three | Softov, 2026-09-26: "All three" | 01, 03 |
| A need is filled from the profile, then the plugin option, then the agent's default | the idea, settled by Softov | 02 |
| Defaults come from the host user's folder; the docs warn that it is shared | the idea, settled by Softov | 05, 07 |
| Same-path mounts for the session folder, so Claude's history is one list | Softov: "Same-path mounts for now" | 03 |
| Claude's executable default is what `~/.local/bin/claude` points at | the 127 found on 2026-09-26 | 05 |
| Disposable machines are their own plan | Softov: "Their own plan, right after" (`plugin/16`) | - |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The SDK has machine() and the need type](task-01-the-need-type.md) | todo | - |
| [02 - The host resolves an agent's needs for a machine maker](task-02-the-host-resolves-needs.md) | todo | 01 |
| [03 - Docker makes a machine from resolved needs](task-03-docker-applies-needs.md) | todo | 02 |
| [04 - The picker and the host keep an agent to its machines](task-04-agents-kept-to-their-machines.md) | todo | 03 |
| [05 - Claude declares its needs](task-05-claude-declares.md) | todo | 01 |
| [06 - Cofold declares its needs](task-06-cofold-declares.md) | todo | 01 |
| [07 - Docs](task-07-docs.md) | todo | 04, 05, 06 |

## Risks and tradeoffs

- A shared `~/.claude` in a company is one sign-in for everyone; the docs say so until per-person isolation exists.
- Copy-in is paid on every create and loses what the agent writes there when the machine goes.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-need-type.md](task-01-the-need-type.md), with 05 and 06 after it in parallel.
- **Open questions:** none.
- **Watch out for:** an existing profile with hand-written `mounts` and no `agents` keeps working unchanged.

## Final verification checklist

- [ ] A profile with `agents: ["claude"]` and no mounts makes a machine a Claude session runs in, on this host's sign-in.
- [ ] A profile whose need points at a missing path is refused at create, with the path in the sentence.
- [ ] The picker for cofold does not offer a machine prepared only for Claude, and a session forced onto one is refused.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `docs/COMPUTER.md`, `plans/index.md` updated.
