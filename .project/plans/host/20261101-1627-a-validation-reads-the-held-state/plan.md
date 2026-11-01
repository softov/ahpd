---
title: A validation reads the held state
domain: host
status: built
priority: high
created: 2026-11-01
revalidated: 2026-11-01
requires:
  - plans/host/20261101-0329-the-hosts-state-is-the-reducers-output/plan.md
  - plans/host/20261101-1357-backends-say-their-state-by-actions/plan.md
  - plans/host/20261101-1357-a-case-starts-from-its-initial/plan.md
  - plans/host/20261101-1641-every-backend-says-its-state-by-actions/plan.md
refs:
  - git://b7a08801 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L345-L359 - the chat channel's validation of client actions, each a condition over the chat's state"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/elicitation.md#L67-L76 - an input action is checked against the unresolved request part in the active turn"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L232 - the reducer runs on server and client, and side effects live in a separate dispatch layer"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2744-L2751 - the reference applies a client's action to its state and emits it with the client's origin"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentService.ts#L13526-L13535 - the reference matches a cancel against the held chat state's active turn before the side effect"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentService.ts#L13463-L13489 - the reference reads a resume's conditions off the held chat state"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentService.ts#L13493-L13508 - the reference refuses removing a steering message its provider cannot take back"
  - "[code://packages/sdk/src/host/chatactions.ts#L1139-L1217](../../../../packages/sdk/src/host/chatactions.ts#L1139-L1217) - a resume and a cancel, checked against the backend's own state"
  - "[code://packages/sdk/src/host/chatactions.ts#L1491-L1593](../../../../packages/sdk/src/host/chatactions.ts#L1491-L1593) - a draft, a removal, a confirmation and an answer, checked against the backend"
  - "[code://packages/sdk/src/host/chatactions.ts#L1765-L1780](../../../../packages/sdk/src/host/chatactions.ts#L1765-L1780) - a draft answer, checked against the backend"
  - "[code://packages/sdk/src/host/spawn.ts#L1174-L1192](../../../../packages/sdk/src/host/spawn.ts#L1174-L1192) - `Start.handed`, where a backend takes a dispatch to answer later"
  - "[code://packages/sdk/src/host.ts#L770-L819](../../../../packages/sdk/src/host.ts#L770-L819) - the dispatch being applied, and how an action answers it"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts) - the oracle, whose `REFUSALS` matches a refusal's words and not its condition"
  - "[code://packages/sdk/src/host/chatactions.ts#L1808-L1866](../../../../packages/sdk/src/host/chatactions.ts#L1808-L1866) - a client's result and streamed content, checked against the backend's record of who runs the call"
  - "[code://packages/agent-claude/src/session/stream.ts#L202-L232](../../../../packages/agent-claude/src/session/stream.ts#L202-L232) - a Claude call opens naming an MCP server where a client runs it"
  - "[code://packages/agent-claude/src/session/asking.ts#L403-L411](../../../../packages/agent-claude/src/session/asking.ts#L403-L411) - a call a question opens names no owner"
  - "[code://packages/sdk/src/tools/clientcalls.ts#L170-L203](../../../../packages/sdk/src/tools/clientcalls.ts#L170-L203) - the input-needed entry of a client's call, which names the holder's one chat"
---

## Goal

A client action the protocol validates over the chat's state is checked against the state the host holds.
That is the state every client was served, so a refusal names a condition the client can see.
An action the held state accepts is said back to every client, by the backend when it says one, and otherwise by the host.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "session\.chatState\(\)" packages/sdk/src/host/chatactions.ts` - a cancel, a resume, a draft and a removal read the backend's state.
- `rg -n "session\.(confirm|answer|setAnswer)\(" packages/sdk/src/host/chatactions.ts` - a confirmation and an answer are refused on the backend's word.
- `rg -n "handed: \(action\)" packages/sdk/src/host/spawn.ts` - where a backend takes a dispatch it answers later.

### Runtime path

```
dispatchAction -> applyDispatch -> the condition over the held chat state -> refuse, or hand to the backend
  the backend says the echo now, or takes the dispatch to say it later, or the host says it
```

### Gaps

- Case 015 cancels the active turn its seeded state holds, and the host answers its sender alone, because the backend runs no turn.
- A resume is checked against the backend's turns and never against an active turn.
- A removal, a confirmation and an answer the held state allows are refused where the backend holds nothing.
- The oracle accepts a refusal by its words, so a refusal whose condition the served state contradicts passes.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A cancel, a resume, a removal, a draft, a confirmation and an input action are checked against the chat's held state | [chat-channel.md#L345-L359](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L345-L359); [elicitation.md#L67-L76](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/elicitation.md#L67-L76); [agentService.ts#L13526-L13535](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentService.ts#L13526-L13535) | 01 |
| A resume is refused while the held state has an active turn, and when the latest turn is not an errored turn with a resumable error | [chat-channel.md#L354](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L354); [agentService.ts#L13463-L13489](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentService.ts#L13463-L13489) | 01 |
| An accepted action the backend neither says back nor takes to say later is said back by the host | [actions.md#L232](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L232); [agentHostStateManager.ts#L2744-L2751](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2744-L2751) | 01 |
| A cancel of a turn the backend does not run is said back by the host, naming that turn | [agentService.ts#L13526-L13535](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentService.ts#L13526-L13535) | 01 |
| A steering message handed to a running turn that its backend does not take back is refused in the reference's words | [agentService.ts#L13493-L13508](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentService.ts#L13493-L13508) | 01 |
| A resume the backend cannot run again is refused, since the turn it would reopen runs nowhere | [agentService.ts#L13463-L13489](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentService.ts#L13463-L13489) | 01 |
| A client's result and streamed content are checked against the running call's client contributor in the held state | `types/channels-chat/actions.ts`, `chat/toolCallComplete` and `chat/toolCallContentChanged`: "the server SHOULD reject this action if the dispatching client does not match the contributor's `clientId`" | 03 |
| A Claude call a client runs names that client at its start, the one place the reducer takes an owner | `types/channels-chat/actions.ts`, `chat/toolCallReady`: "MUST NOT change execution ownership established at `chat/toolCallStart`" | 03 |
| A worker's client call raises its input-needed entry under the worker's chat, where the call is | [session-channel.md#L118](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/session-channel.md#L118) "Every entry carries the owning `chat` URI" | 03 |
| The oracle holds each refusal to its condition over the state its client was served at that action | [chat-channel.md#L345-L359](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L345-L359) | 02 |
| Each oracle entry this plan makes stale leaves the oracle in the same change, shown failing before it | the oracle plan's *Watch out for* | 02 |

## Proposed architecture

- **Data flow** - `applyDispatch` reads the chat's held state, refuses on its condition, and hands the action to the backend.
- **Event flow** - the backend's echo carries the client's origin; `Start.handed` marks a dispatch the backend answers later; the host says the rest.
- **State flow** - the held state moves by the echo, whoever says it, through the chat reducer.
- **Layer responsibilities** - sdk host: the conditions and the echo nobody else says. Backends: the side effect and their own echo.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - each condition reads the held state](task-01-each-condition-reads-the-held-state.md) | done | - |
| [02 - the oracle holds a refusal to its condition](task-02-a-refusal-is-held-to-its-condition.md) | done | 01 |
| [03 - a client's result is checked against its call](task-03-a-clients-result-meets-its-call.md) | done | 01 |

## Risks and tradeoffs

- A held state that names a turn or a question its backend no longer holds is answered on the held state; the backend does nothing.
- A steering removal during a turn is refused for a backend that takes nothing back, as the reference refuses one.

## Resume state

- **Done so far:** tasks 01 to 03.
- **Next action:** none; the plan is built.
- **Open questions:** none.
- **Watch out for:** a backend that answers later takes the dispatch through `Start.handed`; the host says nothing for it.

## Final verification checklist

- [x] Each oracle entry this plan removes failed before the change and passes after it.
- [ ] `pnpm run test:unit --maxWorkers=2` passes, with each failure under load passing alone.
- [x] `pnpm run typecheck` and `pnpm run boundary` exit 0, and the prose lint is clean.
