---
title: A claude client call is the sdk's, opened when it is announced running
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/clienttools.ts#L151-L226](../../../../packages/agent-claude/src/session/clienttools.ts#L151-L226) - the map and the three members that go"
  - "[code://packages/agent-claude/src/session/stream.ts#L367-L445](../../../../packages/agent-claude/src/session/stream.ts#L367-L445) - where the running ready goes out"
  - "[code://packages/agent-claude/src/session.ts#L197](../../../../packages/agent-claude/src/session.ts#L197) - the snapshot's `inputNeeded`"
  - "[code://packages/agent-claude/src/session/turns.ts#L556-L560](../../../../packages/agent-claude/src/session/turns.ts#L556-L560) - `releaseCalls` on a stopped turn"
  - "[code://packages/agent-claude/src/session.ts#L249](../../../../packages/agent-claude/src/session.ts#L249) - `releaseCalls` on dispose"
---

## Objective

A claude call to a client's tool opens in the sdk holder when `chat/toolCallReady` reports it running.
So the entry is raised, and an early answer is kept.
The call times out, and the CLI gets the client's whole content.
The existing client-tool behaviour is unchanged.

## Files

- `UPDATE: packages/agent-claude/src/session/clienttools.ts` - `byClient`, `releaseCalls` and the three members replaced by `createClientCalls`; `ranByClient` waits on `calls.wait(id)`; the handler answers `toMcpContent(answer, id)` with `isError` when `ok` is false.
- `UPDATE: packages/agent-claude/src/session/stream.ts:367-445` - `calls.open` beside the running ready for an owned call.
- `UPDATE: packages/agent-claude/src/session.ts:197` - `calls.entries()` in the snapshot.
- `UPDATE: packages/sdk/test/host-tools.test.ts` - the cases below, on the claude fake.

## Steps

1. Write the cases first and see the entry and early-answer cases fail.
2. Build the holder per chat with the session's `emit`, `Start.clientToolTimeoutMs` and the session's active clients as `providers`.
3. Open at the running ready; wait in the handler; release on stop and dispose as today.

## Validation

- `packages/sdk/test/host-tools.test.ts`, written first:
  - See the call raise one `toolClientExecution` entry naming the owner, and remove it when the answer is in.
  - Have the owner answer before the fake SDK invokes the handler, and see the handler get that answer.
  - Keep the existing cases at lines 527-753 green.
  - Leave a call unanswered and see it fail at the timeout, with the turn going on.
  - Answer with a text and a PNG block, and check the fake SDK's handler result.
  - See that result hold a text block and an MCP `image` block.
- `vitest run packages/agent-claude` green.

## Resume

- **Done:** `packages/agent-claude/src/session/clienttools.ts` builds one `createClientCalls` per session.
  It is built over the session's own `emit`, with `ctx.options.clientToolTimeoutMs` and a `providers` that answers from `ctx.offering`.
  `clientToolOf` replaces `providedBy` and answers the owner and the bare name the client announced.
  `openCall` holds a call the model's frame reports running, with `toolCall.status: running` and `contributor: { kind: 'client', clientId }` filled by the holder.
  `ranByClient` claims the handler's call and waits on `calls.wait(id)`.
  The handler answers `toMcpContent(answer, callId)` with `isError` when `ok` is false.
  `releaseCalls(why)` is the holder's `release`, and `methods` spreads `calls.methods`.
  `packages/agent-claude/src/session/stream.ts` calls `ctx.openCall` beside the running `chat/toolCallReady`, and reads the contributor from `clientToolOf`.
  `packages/agent-claude/src/session.ts` puts `[...ctx.pending.values()].map((one) => one.entry).concat(ctx.calls.entries())` in the snapshot's `inputNeeded`.
  `packages/agent-claude/src/session/context.ts` carries `clientToolTimeoutMs`, and `packages/agent-claude/src/claude.ts` hands `Start.clientToolTimeoutMs` over.
  `packages/sdk/src/index.ts` exports `toMcpContent`, which p1 left unexported and nothing outside the sdk could reach.
- **Failed first:** the four cases in `tools a client contributes` in `packages/sdk/test/host-tools.test.ts` were written before any of it.
  All four failed.
  `raises the call on the session, and takes the entry down with the answer` failed with `expected undefined to deeply equal ObjectContaining`: no entry was ever raised.
  `keeps an answer that arrives before the CLI runs the tool` failed because the handler had nothing to wait on, so the answer was refused.
  `fails a call nobody answers, in the time the host allows` timed out at 5000 ms: nothing limited the wait.
  `hands the model the client's image as an image, and its words as words` failed with `expected [] to deeply equal [{ type: 'text', … }, { type: 'image', … }]`: the handler handed the model the joined text and nothing else.
- **One assertion written wrong, and the code was right:** after the answer, the snapshot omits `inputNeeded` entirely rather than carrying an empty list.
  That is what the echo backend in the same file does, and what the cases at lines 1197 and 1216 read.
  The case now reads `((await watched(client, uri)).inputNeeded ?? [])`.
- **Opened at the running ready, not at the announcement:** the ready is emitted once per call.
  A repeat of a streaming assistant frame is skipped, because the part is no longer `streaming`.
  So the entry is raised exactly once.
  A call `canUseTool` is holding is never announced to a client as one to run.
- **Verification:** `npx vitest run packages/agent-claude` green, 198 cases; `npx vitest run packages/sdk` green, 1503 cases on a clean run; `npx tsc -b` green.
- **Next action:** nothing; this task is implemented. Task 02 is next.
