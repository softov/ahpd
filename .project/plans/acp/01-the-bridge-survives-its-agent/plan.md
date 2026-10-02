---
title: The bridge survives its agent: a bad command, a dying server and a close
domain: acp
status: built
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires: []
changes: []
creates: []
decisions:
  - decisions/acp-bridge-uses-the-protocol-sdk.md
refs:
  - "[code://packages/agent-acp/src/connection.ts#L55-L64](../../../../packages/agent-acp/src/connection.ts#L55-L64) - the spawn: no `error` or `exit` listener, stderr drained and dropped"
  - "[code://packages/agent-acp/src/connection.ts#L159-L164](../../../../packages/agent-acp/src/connection.ts#L159-L164) - close: stdin ended, SIGTERM to the direct child only"
  - "[code://packages/agent-acp/src/catalog.ts#L116-L139](../../../../packages/agent-acp/src/catalog.ts#L116-L139) - `list` spawns a process of its own, with the same missing listener"
  - "[code://packages/agent-acp/src/session.ts#L546-L555](../../../../packages/agent-acp/src/session.ts#L546-L555) - after a death the next turn sends `session/new`, losing the conversation"
  - "[code://packages/agent-acp/src/session.ts#L716-L725](../../../../packages/agent-acp/src/session.ts#L716-L725) - a prompt that rejects mid-turn"
  - "[code://packages/agent-acp/src/session.ts#L1151-L1173](../../../../packages/agent-acp/src/session.ts#L1151-L1173) - close: permissions cancelled, terminals released, no `session/close`"
  - npm://@agentclientprotocol/sdk - `closeSession`, and the connection's `closed` signal
---

## Goal

A spec whose command is missing fails the session that asked, in a sentence, and never ends the daemon.
A server that exits says why, with the tail of what it wrote on stderr, and the next turn reopens the same ACP session instead of starting a new one.
Closing a session tells the server and ends every process it started.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "on\('error'|on\('exit'" packages/agent-acp/src` - nothing.
- Reproduced on Node 24 at research time: a spec with a missing command ends the daemon on the first turn, and on `list`.

### Runtime path

```
connectAcp -> spawn -> [new] error / exit heard -> pending calls rejected with code and stderr tail
next turn after a death -> [changes] session/load or session/resume of acpSessionId
close -> [new] session/close when advertised -> stdin end -> SIGTERM group -> SIGKILL after grace
```

## Decisions locked in

| Decision | Task |
| --- | --- |
| [The ACP bridge uses the published protocol SDK](../../../decisions/acp-bridge-uses-the-protocol-sdk.md) | 04 |

| What | Source | Task |
| --- | --- | --- |
| Keep the last 8 KB of stderr per process | (defaulted: enough for a stack trace, small per session) | 02 |
| A reopen after a death uses the same call a resume would, so it follows plugin 18's choice of `session/resume` or `session/load` | (defaulted: one path for both) | 03 |
| Grace between SIGTERM and SIGKILL is five seconds | (defaulted) | 04 |

## Proposed architecture

- **Layer responsibilities** - `connection.ts`: the child's life, stderr and the kill · `session.ts`: what a failure means to a turn and how a session reopens · `catalog.ts`: the listing process.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A child that fails to start or exits is heard](task-01-a-child-that-fails-is-heard.md) | done | - |
| [02 - The last of stderr rides on a failure](task-02-stderr-rides-on-a-failure.md) | done | 01 |
| [03 - A dead agent is reopened by its id](task-03-a-dead-agent-is-reopened-by-its-id.md) | done | 01 |
| [04 - Close ends the session and every process it started](task-04-close-ends-the-session-and-its-processes.md) | done | - |
| [05 - The docs say what a failing agent looks like](task-05-docs.md) | done | 02, 03, 04 |

## Risks and tradeoffs

- A process group kill on a server that shares its group with something else - the bridge starts every server in a group of its own.

## Resume state

- **Done so far:** built 2026-10-02, see [implemented.md](implemented.md).

## Final verification checklist

- [x] A spec with a missing command fails a turn and the daemon stays up.
- [x] A dying server's stderr tail is in the failure.
- [x] The turn after a death continues the same ACP session.
- [x] Close leaves no process behind.
- [x] `pnpm test`, `pnpm typecheck` green.
- [x] `plans/index.md` updated.
