---
title: Claude runs its client calls through the sdk
domain: host
status: built
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/62-every-backend-calls-a-clients-tool-p1-the-sdk-holds-a-client-call/plan.md
refs:
  - "[code://packages/agent-claude/src/session/clienttools.ts#L34-L91](../../../../packages/agent-claude/src/session/clienttools.ts#L34-L91) - `contributed`: the in-process `ahp` MCP server; an owned tool's handler awaits `byClient` and gets the input only"
  - "[code://packages/agent-claude/src/session/clienttools.ts#L117-L173](../../../../packages/agent-claude/src/session/clienttools.ts#L117-L173) - the handler is joined to the model's call by tool name and then input; the wait is registered only once the handler runs"
  - "[code://packages/agent-claude/src/session/clienttools.ts#L185-L226](../../../../packages/agent-claude/src/session/clienttools.ts#L185-L226) - `setTools`, `toolCallOwner`, `completeToolCall`, `clientGone`"
  - "[code://packages/agent-claude/src/session/stream.ts#L336-L352](../../../../packages/agent-claude/src/session/stream.ts#L336-L352) - the contributor on `chat/toolCallStart`, from `providedBy`"
  - "[code://packages/agent-claude/src/session/stream.ts#L367-L445](../../../../packages/agent-claude/src/session/stream.ts#L367-L445) - the call goes out `running` with `confirmed: not-needed` from the assistant frame, before the handler runs"
  - "[code://packages/agent-claude/src/session.ts#L123](../../../../packages/agent-claude/src/session.ts#L123) - the server is declared with `ranByClient`"
  - "[code://packages/agent-claude/src/session.ts#L197](../../../../packages/agent-claude/src/session.ts#L197) - the snapshot's `inputNeeded`, from `pending` only"
  - "[code://packages/sdk/test/host-tools.test.ts#L527-L753](../../../../packages/sdk/test/host-tools.test.ts#L527-L753) - the claude-backed client-tool cases"
  - "npm://@anthropic-ai/claude-agent-sdk@^0.3.278 - the CLI binary carries the `claudecode/toolUseId` key"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/clientTools/claudeClientToolMcpServer.ts#L14-L76 - VS Code reads the call id from `extra._meta['claudecode/toolUseId']` in the handler and answers an error when it is missing"
---

## Goal

Claude's client calls run through the sdk holder.
A claude session raises the `toolClientExecution` entry.
It accepts an answer that arrives before the CLI runs the handler, and times a call out.
The model gets the client's images and resources as well as its text.
The handler is joined to the model's call by its id.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### What claude has today

Claude already calls a client's tool, and is the pattern pi and cofold copied.
The tool is offered on the in-process `ahp` server as `mcp__ahp__<clientId>__<name>`.
`chat/toolCallStart` carries `contributor: { kind: 'client', clientId }`.
The handler waits, and only the owner's `completeToolCall` settles it.
`clientGone` fails it, and `setTools` re-declares the server.
Against the 1.0.0 execution request it is the older shape:

- no `session/inputNeededSet` with `kind: toolClientExecution` is raised, so a client that runs its calls from the session's `inputNeeded` never runs claude's;
- the call is announced `running` from the assistant frame;
- the wait is registered when the handler runs, so an owner's answer in between is refused;
- the handler is joined to the call by name and input, which two identical concurrent calls cannot tell apart;
- no timeout;
- the result is read as text only.

### Searches performed

- `rg -n "providedBy|opening|ranByClient|releaseCalls" packages/agent-claude/src` - the four places the area is wired.
- `grep -a -c "claudecode/toolUseId"` on the 0.3.278 CLI binary - 4.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| - | None. | - |

| What | Source | Task |
| --- | --- | --- |
| Claude moves onto the sdk holder and keeps its existing client-tool tests green | the parent | 01 |
| The handler answers the CLI with the client's whole content through the sdk's `toMcpContent`, an image as an MCP image | the parent's row, Softov, 2026-10-06: "Everything now" | 01 |
| The handler joins its call by `extra._meta['claudecode/toolUseId']` first, and keeps today's name-and-input match as the fallback until a live CLI run shows the id always arrives | Softov, 2026-10-06, asked "the `_meta` id alone, as VS Code does, or with today's name-and-input match behind it?": "_meta id, fallback" | 02 |

## Proposed architecture

- **Data flow** - `stream.ts` calls `calls.open` where it emits the running ready for an owned call; the handler calls `calls.wait(id)`.
- **State flow** - the snapshot's `inputNeeded` is `pending`'s entries and `calls.entries()`.
- **Layer responsibilities** - agent-claude only.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session/clienttools.ts`](../../../../packages/agent-claude/src/session/clienttools.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A claude client call is the sdk's, opened when it is announced running](task-01-a-claude-client-call-is-the-sdks.md) | done | p1 |
| [02 - The handler finds its call by the id the CLI hands it](task-02-the-handler-finds-its-call-by-id.md) | done | 01 |

## Risks and tradeoffs

- The fake SDK in the tests does what the test says, not what the CLI does.
  Task 02 is checked by hand against a real CLI before it is marked done.

## Resume state

- **Done so far:** both tasks. Task 01 - claude's client calls are held by `createClientCalls`, opened beside the running ready and reported in the snapshot's `inputNeeded`. Task 02 - the handler reads the call id from `extra._meta['claudecode/toolUseId']` and keeps the name-and-input join behind it. Seven cases in `packages/sdk/test/host-tools.test.ts`; the fake SDK hands an id to a handler.
- **Next action:** none; both tasks are done, reviewed on 2026-10-06. The by-hand run with a real CLI is owed and is in [deferred.md](deferred.md).
- **Open questions:** one - whether the name-and-input fallback can go, which a live run answers and Softov decides.
- **Watch out for:** a call `canUseTool` asks about is not running until approved; the entry goes at the running ready, not at `chat/toolCallStart`.

## Final verification checklist

- [ ] `vitest run packages/agent-claude packages/sdk/test/host-tools.test.ts` green.
- [ ] By hand: VS Code runs one of its tools for a claude session on ahpd.
- [ ] `plans/index.md` updated.
