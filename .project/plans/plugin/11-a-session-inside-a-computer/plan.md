---
title: A session runs inside a computer
domain: plugin
status: built
priority: high
created: 2026-09-23
revalidated: 2026-09-23
requires:
  - plans/plugin/10-a-computer-a-person-manages/plan.md
  - plans/plugin/07-agent-acp/plan.md
changes: []
creates: []
decisions:
  - decisions/a-backend-reaches-a-computer-through-a-port.md
  - decisions/the-computer-is-an-object-a-person-manages.md
refs:
  - "[code://packages/computer/src/runtime.ts#L30-L45](../../../../packages/computer/src/runtime.ts#L30-L45) - `MachineSpec`, which names no mount and no working directory"
  - "[code://packages/computer/src/runtime.ts#L173-L182](../../../../packages/computer/src/runtime.ts#L173-L182) - `run`, which starts a container with none"
  - "[code://packages/computer/src/runtime.ts#L187-L192](../../../../packages/computer/src/runtime.ts#L187-L192) - `exec`, which collects output rather than streaming"
  - "[code://packages/agent-acp/src/connection.ts#L50-L60](../../../../packages/agent-acp/src/connection.ts#L50-L60) - the one `spawn`, which is the process that has to move"
  - "[code://packages/agent-acp/src/agent.ts](../../../../packages/agent-acp/src/agent.ts) - where a session is opened and where `Start` arrives"
  - "[code://packages/sdk/src/types/agent.ts#L92-L141](../../../../packages/sdk/src/types/agent.ts#L92-L141) - `Start`, which carries the ports"
  - "[code://packages/sdk/src/types/plugin.ts#L101-L140](../../../../packages/sdk/src/types/plugin.ts#L101-L140) - `register*`, where `registerComputers` goes"
  - "[code://.project/ideas/dev-container-sessions.md](../../../ideas/dev-container-sessions.md) - the reference host's own answer to a session in a container"
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - the operator's page"
---

## Goal

A session created with `computer: 'computer://<name>'` runs its agent inside that machine: the ACP backend spawns its server through the machine rather than on the host, the machine can see the session's workspace, and a backend handed no way to reach the machine refuses instead of running locally.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "spawn\\(" packages/agent-acp/src packages/agent-claude/src packages/agent-cofold/src` - ACP spawns one command (`connection.ts:56`), Claude's SDK spawns the CLI internally, and cofold runs in this process; ACP is the one a wrapper moves.
- `rg -n "-v|--mount|volumes|workdir" packages/computer/src` - nothing: `dockerRuntime.run` builds `run -d --name --label` and the limits, so a machine sees nothing of this host today.
- `rg -n "settings" packages/agent-acp/src/agent.ts` - the session's `Start.settings` arrives at `open`, which is where a `computer` value would be read.
- `rg -n "register(Computers|Terminals|Resources)" packages/sdk/src/types/plugin.ts` - no computers port exists; the nearest is `registerTerminals`, which is a host-wide store and not a per-machine process.
- `rg -n "docker" .project/plans/plugin/09-computer-provider .project/plans/plugin/08-resource-providers` - the provider and the runtime were built with a read-only provider and a `sleep infinity` container, which is a machine waiting for work and not one a session can live in.

### Runtime path

```
createSession({ computer: 'computer://box' })
  -> the schema's key, stored with the session
  -> agent.start(...) -> Start.settings.computer = 'computer://box'
  -> the ACP backend asks Start.computers.how('box', { command, args, cwd })
  -> { command: 'docker', args: ['exec','-i','-w',dir,'box',cmd,...] }
  -> connectAcp spawns that  ->  the ACP server runs in the machine
```

### Gaps

- A machine has no mount and no working directory, so a session's files are not in it.
- No port carries a machine from the computer plugin to a backend, and no backend can name one.
- The ACP backend always spawns on the host; it never reads the session's `computer`, and it has nothing to read it with.
- `ComputerRuntime.exec` answers collected output, so it cannot carry a protocol over stdio.
- Nothing in the suite runs Docker, so the end-to-end case has to be honest about what it needs.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A backend reaches a machine through a port the host carries](../../../decisions/a-backend-reaches-a-computer-through-a-port.md) | The user, 2026-09-23: "Include ACP-inside-a-computer in this step", and no backend may depend on one machine plugin. |
| 2 | [A computer is an object a person manages, and a session runs in one](../../../decisions/the-computer-is-an-object-a-person-manages.md) | The user, 2026-09-23: "restricted.. sandboxed.. private. On the same computer... or just fire/run/die a computer per session." |

| What | Source | Task |
| --- | --- | --- |
| The port answers a spawn descriptor, not a running process | decision 1 | 02 |
| A backend with no way to reach the named machine refuses | decision 1 | 03 |
| The manifest gains mounts and a working directory | decision 2 | 01 |
| An end-to-end case is by hand, and the suite drives a fake port | decision 2 | 04 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A machine can see a workspace](task-01-a-machine-can-see-a-workspace.md) | done | - |
| [02 - The host carries the computers port](task-02-the-host-carries-the-computers-port.md) | done | - |
| [03 - ACP spawns through the named machine](task-03-acp-spawns-through-the-machine.md) | done | 02, plugin/10 task 06 |
| [04 - A session inside a machine, proved](task-04-a-session-inside-a-machine.md) | done | 03 |
| [05 - The pages say what a session in a machine needs](task-05-the-pages.md) | done | 01, 03 |

## Risks and tradeoffs

- The ACP server has to exist inside the machine and the workspace has to be mounted, so an image is not enough on its own.
  The mitigation is that mounts and a working directory are manifest fields with tests, and the acceptance case names the image it needs rather than assuming one.
- An image that has no ACP server, or a machine whose command cannot be found, is discovered when the server fails to start.
  The mitigation is that the failure is the backend's own startup failure and it is reported as a sentence, not a session that opens empty.
- A bind mount is the host's filesystem made visible in the machine, so the isolation is a container and not a boundary the host enforces.
  The mitigation is that this is said plainly in the docs, and the machine's own filesystem is where the server runs.
- The end-to-end case cannot run in `pnpm test`, which is network-free and has no Docker.
  The mitigation is that the suite drives a fake port that asserts the descriptor, and the real case is a by-hand checklist with the machine named.
- Claude and cofold cannot be moved the same way, and a session naming a computer on one of them must not quietly run on the host.
  The mitigation is decision 1's refusal: a backend that cannot honour the key refuses, and this plan only moves ACP.

## Resume state

- **Done so far:** every task, 2026-09-23. See [implemented.md](implemented.md). The plan is written and the decision is locked in.
- **Next action:** none; the plan is built. Was: [task-01-a-machine-can-see-a-workspace.md](task-01-a-machine-can-see-a-workspace.md).
- **Open questions:**
  1. Does the machine get the session's directory as a bind mount, or a copy? - proposed: a bind mount, because a session's work has to be visible to the person outside it, and a copy makes the machine a different place rather than a sandbox of the same one.
  2. Who creates the machine when a session names one that is not there? - proposed: nobody; the session refuses with a sentence, and making one is the person's resource write, which is the whole point of the lifecycle.
  3. Does a session's machine survive the session? - proposed: yes, by default; destroying it is a person's resource delete, and an "ephemeral" option that does it at session end is a later addition.
- **Watch out for:** `--token` in this client's own CLI is the connection token and not a resource token; a machine's `-e` environment is a different thing again. The descriptor must not carry the daemon's whole environment into a container by default.

## Final verification checklist

- [x] `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- [x] A manifest with mounts and a working directory reaches `docker run` with `-v` and the machine's `exec` works in that directory, against the fixture runtime.
- [x] `Start.computers.how` answers the descriptor for a machine, and a machine that is not there answers a sentence.
- [x] The ACP backend spawns the descriptor's command when the session names a computer, and refuses when it cannot.
- [x] By hand: a machine from an image with the ACP server, a session created with `computer`, and the server answering inside the machine. Named in `docs/COMPUTER.md`.
- [x] `plans/index.md`, `docs/COMPUTER.md`, `docs/PLUGINS.md` and `working/HANDOFF.md` updated.
