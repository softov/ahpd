---
title: Host and client tools reach pi
domain: pi
status: active
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/types/agent.ts#L41-L73](../../../../packages/sdk/src/types/agent.ts#L41-L73) - `BoundTool`: a definition, `run` for a host tool, `owner` for a client's"
  - "[code://packages/sdk/src/types/agent.ts#L113-L119](../../../../packages/sdk/src/types/agent.ts#L113-L119) - `Start.tools`, which pi never reads"
  - "[code://packages/sdk/src/types/session.ts#L385-L427](../../../../packages/sdk/src/types/session.ts#L385-L427) - `setTools`, `toolCallOwner`, `completeToolCall`, `clientGone`"
  - "[code://packages/sdk/src/host.ts#L4395-L4410](../../../../packages/sdk/src/host.ts#L4395-L4410) - the host already builds `<clientId>__<name>` tools with an `owner` for every backend"
  - "[code://packages/agent-pi/src/backend.ts#L83-L96](../../../../packages/agent-pi/src/backend.ts#L83-L96) - `openPi`, where `customTools` would be passed"
  - "[code://packages/agent-pi/src/mapping.ts#L129-L150](../../../../packages/agent-pi/src/mapping.ts#L129-L150) - `tool_execution_start`, which opens a call with no `contributor`"
  - "[code://packages/agent-claude/src/session.ts#L484-L540](../../../../packages/agent-claude/src/session.ts#L484-L540) - the sibling turns each `BoundTool` into a tool whose handler runs `run()` or waits on the owning client"
  - "[code://packages/agent-claude/src/session.ts#L724-L791](../../../../packages/agent-claude/src/session.ts#L724-L791) - `offering`, `providedBy`, and the calls waiting on a client"
  - "[code://packages/agent-claude/src/session.ts#L1469-L1475](../../../../packages/agent-claude/src/session.ts#L1469-L1475) - a client's call carries `contributor: { kind: 'client', clientId }`"
  - "[code://packages/agent-claude/src/session.ts#L3274-L3316](../../../../packages/agent-claude/src/session.ts#L3274-L3316) - `setTools`, `toolCallOwner`, `completeToolCall`, `clientGone`"
  - "[code://packages/agent-cofold/src/session.ts#L228-L235](../../../../packages/agent-cofold/src/session.ts#L228-L235) - the other sibling keeps `offered` mutable and builds its agent per turn from it"
  - "[code://packages/agent-cofold/src/session.ts#L1396-L1399](../../../../packages/agent-cofold/src/session.ts#L1396-L1399) - so its `setTools` always answers true and takes effect next turn"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - `defineTool` and `ToolDefinition.execute(toolCallId, params, signal, onUpdate, ctx)` in `dist/core/extensions/types.d.ts`; `customTools` on `CreateAgentSessionFromServicesOptions` in `dist/core/agent-session-services.d.ts`, read once when the session is built
  - npm://@earendil-works/pi-ai@^0.87.1 - re-exports `Type` from `typebox`, so `Type.Unsafe(inputSchema)` needs no new dependency
---

## Goal

The tools the host contributes to a pi session, and the tools a connected client provides, are offered to pi's model.
A host tool runs in the host; a client's tool is reported against that client and pi waits for its answer.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "start.tools|setTools|toolCallOwner|completeToolCall|clientGone" packages/agent-pi` - nothing.
- `grep -n "_customTools" dist/core/agent-session.js` in pi 0.87.1 - set once in the constructor from `config.customTools`; the public surface can only toggle registered names (`setActiveToolsByName`).
- `grep -n "typebox" package.json` in pi-ai and pi-coding-agent - both pin `typebox` 1.3.27 and pi-ai re-exports `Type`.

### Runtime path

```
host Start.tools -> piSession offering -> [new] tools.ts toPiTool(BoundTool) -> openPi customTools
  -> model calls it -> ToolDefinition.execute(toolCallId, params)
     host tool:   await bound.run(params) -> tool result
     client tool: toolCallOwner(toolCallId) = owner -> wait -> completeToolCall(toolCallId, clientId, result) -> tool result
  -> pi tool_execution_end -> mapping.ts chat/toolCallComplete
```

### Gaps

- pi's `execute` receives the call id, so the sibling's join of a call to its handler by name and input ([`code://packages/agent-claude/src/session.ts#L735-L770`](../../../../packages/agent-claude/src/session.ts#L735-L770)) is not needed here.
- pi fixes its custom tools when the session is built, so a client tool announced after pi opened is added by rebuilding the session before the next turn.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Accept `Start.tools` and convert each `BoundTool` to a pi `defineTool`, passed as `customTools` to `createAgentSessionFromServices` | Softov, 2026-09-26: "converting each bound tool to a pi `defineTool` passed as `customTools` to `createAgentSessionFromServices`" | 01 |
| A host tool runs through `run()`; a client-owned tool is reported to its client | Softov, 2026-09-26: "Host tools run through `run()`; client-owned tools are reported to their client" | 01, 02 |
| The shape is `@ahpd/agent-claude`'s: one conversion, a map of calls waiting on a client, `toolCallOwner`, `completeToolCall`, `clientGone`, and `contributor` on the call | Softov, 2026-09-26: "Mirror how `@ahpd/agent-claude` consumes `Start.tools`" | 01, 02 |
| The schema is `Type.Unsafe(definition.inputSchema)` from pi-ai's own `Type` | pi-ai 0.87.1 re-exports `Type` from `typebox` | 01 |
| Every host tool is offered, destructive ones included; asking before one runs is plan 09 | Softov, 2026-09-26, answering whether destructive host tools should wait for approvals: "offer every host tool" | 01 |
| Once pi is open, `setTools` keeps the new list and pi is rebuilt on the same session file before the next turn | Softov, 2026-09-26, answering how `setTools` acts once pi is open: "rebuild pi on the same session file before the next turn" | 03 |
| A `setTools` at any moment reaches pi, a running turn judges with the tools it was built with, and a tool hears pi's abort. | Softov, 2026-09-27, asked which review findings in the pi batch become fix tasks: "B3 setTools lost mid-open", "B7-B10 row, rebuild, abort" | 05 |
| A rebuild keeps model, thinking level and id, and a failed one fails only its turn. | Softov, 2026-09-27, asked which review findings in the pi batch become fix tasks: "B4 one failure breaks session", "B7-B10 row, rebuild, abort" | 06 |
| Each named case fails without its fix. | Softov, 2026-09-27, asked which review findings in the pi batch become fix tasks: "Tests that fail without fix" | 07 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Host tools are pi tools](task-01-host-tools-are-pi-tools.md) | implemented | - |
| [02 - A client's tool is run by that client](task-02-a-client-tool-is-run-by-that-client.md) | implemented | 01 |
| [03 - The tools change with the clients](task-03-the-tools-change-with-the-clients.md) | implemented | 02 |
| [04 - The README lists the tools](task-04-the-readme-lists-the-tools.md) | implemented | 03 |
| [05 - Tools announced while pi opens reach it, and a tool hears pi's abort](task-05-tools-announced-while-pi-opens-reach-it.md) | implemented | 03 |
| [06 - A rebuild keeps the model, the thinking level and the session](task-06-a-rebuild-keeps-the-session.md) | implemented | 05 |
| [07 - The tool and truncation tests fail when their fix is taken out](task-07-the-tests-fail-without-their-fix.md) | implemented | 06 |

## Risks and tradeoffs

- A destructive host tool, such as a computer tool, runs without asking until [plan 09](../09-pi-asks-before-a-tool-runs/plan.md) lands.
- A rebuild reruns pi's `session_start` for extensions and rereads the model list; it happens only between turns and only when the tool set changed.
- A client that leaves while its call waits must release it, or pi waits for ever; `clientGone` does that, as in the sibling.
- The model sees the host's tool names as they are; pi has no namespace for custom tools, so a host tool named like one of pi's built-ins would collide. Task 01 checks and drops a colliding one with a warning.

## Resume state

- **Done so far:** tasks 01 to 07 are `implemented`: the tool conversion, the client wait and its `Session` methods, the `contributor`, `setTools` rebuilding pi on the same file, the README bullet, a change made at any moment reaching pi, a rebuild that keeps the model and the session and fails only its turn, and the four cases checked to fail without their guarded line.
- **Next action:** none; all seven tasks are implemented and awaiting review; tasks 01 to 04 were reviewed on 2026-09-27.
- **Open questions:** none.
- **Watch out for:** the host names a client tool `<clientId>__<name>`; the owner is `BoundTool.owner`, never parsed back out of the name.

## Final verification checklist

- [ ] A host tool offered at start is called by pi and its `run()` answer is the tool result.
- [ ] A client tool call is reported with `contributor: { kind: 'client' }`, `toolCallOwner` names the client, and `completeToolCall` from that client settles it.
- [ ] A client that leaves releases its waiting calls as failed.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary`, `pnpm wire` green.
- [ ] `plans/index.md` updated.
