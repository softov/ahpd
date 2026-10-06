---
title: A client call is held in one place
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/agent-claude/src/session/clienttools.ts#L151-L226](../../../../packages/agent-claude/src/session/clienttools.ts#L151-L226) - the map, release, owner check and gone this replaces"
  - "[code://packages/agent-cofold/src/turnagent.ts#L276-L285](../../../../packages/agent-cofold/src/turnagent.ts#L276-L285) - the gone message that names the tool"
  - "[code://packages/sdk/src/types/session.ts#L443-L471](../../../../packages/sdk/src/types/session.ts#L443-L471) - `toolCallOwner`, `completeToolCall`, `clientGone`, which the holder answers"
  - "[code://packages/sdk/src/index.ts](../../../../packages/sdk/src/index.ts) - where the holder is exported"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `SessionToolClientExecutionRequest` and `ToolCallRunningState` (`channels-session/state.ts:370-404`, `channels-chat/state.ts:1497-1506`)"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1544-L1575 - the failure text, and the hint when another client provides the tool"
---

## Objective

`createClientCalls` in the sdk holds every call a client runs for one chat: it raises and removes the session entry, waits for the owner, keeps an early answer, and fails a call on leave, release or timeout.

## Files

- `CREATE: packages/sdk/src/clientcalls.ts` - `createClientCalls`, `ClientCalls`, `ClientCallAnswer` (`{ ok, text, content }`: `text` is the text blocks joined, which is what a text-only harness reads, and `content` is the client's `ToolResultContent[]` as it sent it).
- `UPDATE: packages/sdk/src/index.ts` - export them.
- `CREATE: packages/sdk/test/clientcalls.test.ts` - the cases below.

## Steps

1. Write `clientcalls.test.ts` first and see every case fail on the missing module.
2. `createClientCalls({ chat, emit, timeoutMs, providers })`: `emit(channel, action)` is the backend's own; `providers(name)` answers which active clients offer a bare tool name, for the gone hint.
3. `open({ turnId, toolCall, owner })` stores the call and emits `session/inputNeededSet` with `{ id: toolClientExecution:<chat>:<turn>:<call>, kind: 'toolClientExecution', chat, turnId, clientId: owner, toolCall }`, `toolCall.status` `running` and its `contributor`; opening the same id twice emits once.
4. `wait(toolCallId)` returns the answer's promise; an answer `complete` took before `wait` resolves it at once; `wait` on an id never opened opens nothing and rejects, so a backend that forgot `open` fails loudly in tests.
5. `complete(toolCallId, clientId, answer)` settles only for the owner and answers `false` otherwise, leaving the call open (the protocol's "SHOULD reject").
6. `gone(clientId)` fails that client's calls with `The client <clientId> that was running <name> is no longer here`, and adds `<other>__<name> provides the same tool` when `providers` names another client.
7. `release(why)` fails every call, for cancel, close and turn end.
8. The timer starts at `open`, at `timeoutMs` (the daemon's `clientToolTimeoutMs`, 10 minutes by default), and fails the call with `<name> got no answer from <clientId> in <n> s`; `timeoutMs: 0` sets no timer.
9. Every end clears the timer and emits `session/inputNeededRemoved` once; `entries()` lists the open entries for the snapshot.
10. `methods` gives `toolCallOwner`, `completeToolCall`, `clientGone` in the `Session` shapes.

## Validation

- `packages/sdk/test/clientcalls.test.ts`, written first:
  - `open` emits one `session/inputNeededSet` whose request validates against the protocol's `SessionToolClientExecutionRequest`; a second `open` of the id emits nothing.
  - `wait` resolves with the owner's answer, and the removal is emitted once.
  - an answer with a text block and an image block resolves with both in `content` and the text alone in `text`.
  - an answer before `wait` is kept and `wait` resolves with it.
  - another client's `complete` answers `false` and the call still waits.
  - `gone` fails only that client's calls, and the text names the other client's `<clientId>__<name>` when two clients provide the name.
  - with fake timers, an unanswered call fails at `timeoutMs` with `ok: false` and its entry is removed; `timeoutMs: 0` waits on.
  - `release` fails every call and leaves `entries()` empty.
- Each case is run against the module with its step removed and seen to fail.
- `pnpm typecheck` and `pnpm boundary` green.

## Resume
