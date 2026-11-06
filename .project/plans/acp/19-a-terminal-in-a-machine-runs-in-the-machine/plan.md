---
title: A terminal an ACP agent in a machine asks for runs in the machine
domain: acp
status: built
priority: high
created: 2026-10-20
revalidated: 2026-10-20
requires: []
changes:
  - specs/agent-backends.md
creates: []
decisions:
  - decisions/an-acp-agents-terminal-in-a-machine-runs-in-the-machine.md
refs:
  - "[code://packages/agent-acp/src/session/handlers.ts#L261-L279](../../../../packages/agent-acp/src/session/handlers.ts#L261-L279) - `openTerminal`, which opens every terminal on the host's shells with the cwd as the agent sent it"
  - "[code://packages/agent-acp/src/session/opening.ts#L224-L249](../../../../packages/agent-acp/src/session/opening.ts#L224-L249) - `placed`, the session's machine read from its settings and the server spawned there through `computers.how`: the pattern to reuse"
  - "[code://packages/agent-acp/src/session/opening.ts#L378-L392](../../../../packages/agent-acp/src/session/opening.ts#L378-L392) - the terminal handlers, wired whenever `start.terminals` is there, whatever the placement"
  - "[code://packages/sdk/src/host/terminals.ts#L158-L196](../../../../packages/sdk/src/host/terminals.ts#L158-L196) - `heldTerminals.open`, synchronous, on the host's shells"
  - "[code://packages/sdk/src/types/computers.ts#L207-L208](../../../../packages/sdk/src/types/computers.ts#L207-L208) - `ComputerPort.how`, the descriptor for a command in a machine"
  - "[code://packages/computer/src/runtime.ts#L2330-L2338](../../../../packages/computer/src/runtime.ts#L2330-L2338) - `how` takes a host cwd and maps it through the machine's mounts"
  - "[code://packages/agent-claude/src/claude.ts#L367-L386](../../../../packages/agent-claude/src/claude.ts#L367-L386) - Claude's CLI entering a machine through `how`, with the host cwd"
  - "[code://packages/agent-acp/test/agent-acp-machine.test.ts#L383-L419](../../../../packages/agent-acp/test/agent-acp-machine.test.ts#L383-L419) - sessions placed with a stub `computers.how`; no terminal case"
  - "[code://packages/agent-acp/test/agent-acp-ports.test.ts#L262-L268](../../../../packages/agent-acp/test/agent-acp-ports.test.ts#L262-L268) - the only terminal case, for a session on the host"
---

## Goal

A session that asked for a machine runs its ACP agent's commands in that machine, on every platform.
Today a terminal an ACP agent asks for always runs on the host: on Linux and macOS outside the sandbox the session asked for, with nothing to say so, and on Windows not at all, since the cwd is a machine path the host has no folder at.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "terminals" packages/computer/src` - nothing: the computer plugin never replaces a session's terminals.
- `rg "start.terminals" packages/*/src` - only agent-acp's `opening.ts` and `handlers.ts` use it; Claude, cofold and pi run their whole process in the machine.
- `rg "hostPathOf\(" packages/*/src` - no terminal cwd is translated anywhere.
- Found on a Windows VM with Docker Desktop 29.9.1, 2026-10-20, tracing the ACP traffic of a disposable machine: `terminal/create` with `cwd: "/c/work/demo"` answered `Internal error`, `Cannot create process, error code: 267`.

### Runtime path

```
ACP server in the machine -> terminal/create (machine cwd)
  -> agent-acp openTerminal -> start.terminals.open (host shells, host spawn)
  -> today: the command runs on the host
  -> after: computers.how(id, command, host cwd) -> docker exec descriptor -> start.terminals.open on it
```

### Gaps

- `openTerminal` does not look at the session's placement.
- No test sends `terminal/create` from a session placed in a machine; on Linux one would pass with the command on the host, since the machine path is the host's.
- `.project/specs/agent-backends.md` says `Start.terminals.open` opens a host terminal, and nothing about a session in a machine.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A terminal an ACP agent in a machine asks for runs in the machine](../../../decisions/an-acp-agents-terminal-in-a-machine-runs-in-the-machine.md) | Softov, 2026-10-20 |

| What | Source | Task |
| --- | --- | --- |
| A plan of its own, not a task of daemon/33 p7 | Softov, 2026-10-20, "New plan (Recommended)" | - |
| The terminal stays the host's to list and watch; only the process moves | [decision](../../../decisions/an-acp-agents-terminal-in-a-machine-runs-in-the-machine.md) | 01 |

## Proposed architecture

- **Data flow** - the machine's cwd comes back through `hostPathOf`, goes to `computers.how` with the command, and the descriptor it answers is what the host's terminal runs.
- **Layer responsibilities** - agent-acp: reads the placement once, for the server and for each terminal · computer: answers `how`, as for Claude · sdk: unchanged.
- **Source-of-truth files** - [`code://packages/agent-acp/src/session/handlers.ts`](../../../../packages/agent-acp/src/session/handlers.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A terminal in a machine runs in the machine](task-01-a-terminal-in-a-machine-runs-in-the-machine.md) | done | - |
| [02 - The spec says where a machine session's terminal runs](task-02-the-spec-says-where-a-machine-sessions-terminal-runs.md) | done | 01 |

## Risks and tradeoffs

- `heldTerminals.open` is synchronous and `how` is not, so a terminal in a machine opens after one await - the ACP request is already async, so the agent waits as it would for any request.
- A machine that went away between the turn and the request has no descriptor - the request fails with the machine's name, as `placed` does, and never falls back to the host.

## Resume state

- **Done so far:** tasks 01 and 02 implemented 2026-10-20, and their gates pass on Linux. A terminal in a placed session asks `computers.how` and opens the descriptor it answers on the host's shells. The spec and the computer docs say so.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** a records follow-up that Softov must review to define. See [acp-19-records-follow-up.md](../../../pending/acp-19-records-follow-up.md).
- **Watch out for:** on Linux and macOS a host spawn at the machine's path succeeds, so only the `how` assertion shows the command was placed.

## Final verification checklist

- [ ] A `terminal/create` from a session placed in a machine is spawned through `computers.how`, on Linux and on Windows.
- [ ] A session on the host opens its terminals as before.
- [ ] By hand on Windows with Docker Desktop: the scripted agent's `paint` turn in a disposable machine writes `painted.txt` (`.project/pending/windows-machine-paths-checks.md`).
