---
title: Claude runs its client calls through the sdk - implemented
date: 2026-10-06
refs:
  - git://build/agents/8cd9a284
  - "[code://packages/agent-claude/src/session/clienttools.ts](../../../../packages/agent-claude/src/session/clienttools.ts)"
  - "[code://packages/agent-claude/src/session/stream.ts](../../../../packages/agent-claude/src/session/stream.ts)"
  - "[code://packages/agent-claude/src/session/asking.ts](../../../../packages/agent-claude/src/session/asking.ts) - the confirmation path: hold, then allow or refuse"
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts)"
  - "[code://packages/sdk/src/clientcalls.ts](../../../../packages/sdk/src/clientcalls.ts) - the holder's `hold`, which the confirmation path needs"
  - "[code://packages/sdk/test/host-tools.test.ts](../../../../packages/sdk/test/host-tools.test.ts)"
  - "[code://packages/sdk/test/clientcalls.test.ts](../../../../packages/sdk/test/clientcalls.test.ts) - the holder's own cases"
  - "[code://packages/sdk/test/support/claude-sdk.ts](../../../../packages/sdk/test/support/claude-sdk.ts)"
---

A Claude session's calls to its clients' tools are the sdk's now.
Each call is raised on the session as the protocol's `toolClientExecution` entry.
The entry goes up the moment the CLI reports the call running.
A client that runs its tools from `inputNeeded` finds it, and so does one watching the chat.
An answer that arrives before the harness asks for it is kept rather than refused.
A call nobody answers fails in the ten minutes the host allows, instead of blocking the turn for ever.

The model receives the client's images and files, not only its words.
A handler learns which call it runs from the id the CLI names it with.
Two identical concurrent calls no longer take each other's answer.
A call a person is asked about has no entry while the question is out, and is raised when they allow it.
A declined call hands its handler a refusal.
A stopped turn settles every waiter and forgets every join (the review of 2026-10-06).

## What was built

- [`code://packages/agent-claude/src/session/clienttools.ts`](../../../../packages/agent-claude/src/session/clienttools.ts) - one `createClientCalls` per session, over the session's own `emit`, `ctx.options.clientToolTimeoutMs` and a `providers` read from `ctx.offering`.
  `clientToolOf` answers the owner and the bare name the client announced.
  `openCall` holds a call with `status: running` and the client contributor.
  `ranByClient` resolves the CLI's id from `extra._meta['claudecode/toolUseId']` and waits on it.
  Without an id it warns, and joins by tool name and input.
  The handler answers `toMcpContent(answer, callId)`, with `isError` when the answer failed.
  The confirmation path is `holdCall`, `allowCall` and `refuseCall`, and `releaseCalls` releases every call and refuses every join (the review of 2026-10-06).
- [`code://packages/agent-claude/src/session/asking.ts`](../../../../packages/agent-claude/src/session/asking.ts) - `canUseTool` removes the entry with `ctx.holdCall` before the question is put.
  `confirm` opens the call with `ctx.allowCall` when the person allows it, and refuses it with `ctx.refuseCall` when they decline (the review of 2026-10-06).
  A refusal answers the waiting handler and ends the call, because nothing will run it.
- [`code://packages/sdk/src/clientcalls.ts`](../../../../packages/sdk/src/clientcalls.ts) - `hold` removes a call's entry while it waits on something else, and keeps the call.
  `open` raises the entry again when whatever it waited for is over (the review of 2026-10-06).
- [`code://packages/agent-claude/src/session/stream.ts`](../../../../packages/agent-claude/src/session/stream.ts) - `ctx.openCall` beside the running `chat/toolCallReady`.
  That ready is the one moment a call is under way and not merely announced.
  A call `canUseTool` is holding is never raised as one to run.
- [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - the snapshot's `inputNeeded` is `pending`'s entries and `calls.entries()`.
- [`code://packages/agent-claude/src/session/context.ts`](../../../../packages/agent-claude/src/session/context.ts), [`code://packages/agent-claude/src/claude.ts`](../../../../packages/agent-claude/src/claude.ts) - `clientToolTimeoutMs` on the session's options, handed over from `Start`.
- [`code://packages/sdk/src/index.ts`](../../../../packages/sdk/src/index.ts) - `toMcpContent` exported, which p1 built and left unexported, so nothing outside the sdk could reach it.
- [`code://packages/sdk/test/host-tools.test.ts`](../../../../packages/sdk/test/host-tools.test.ts) - eleven cases in `tools a client contributes`.
  Seven were written before the code, and four more for the review.
  The four drive a client tool a person is asked about: allowed, declined, frame first and gate first.
  One stops the turn with a handler still waiting.
  [`code://packages/sdk/test/support/claude-sdk.ts`](../../../../packages/sdk/test/support/claude-sdk.ts) - the fake hands a handler the next queued id as `extra`, and none when a test says the CLI named no call.
- [`code://packages/sdk/test/clientcalls.test.ts`](../../../../packages/sdk/test/clientcalls.test.ts) - four cases for `hold`, written before the code.
  The entry goes down and the call stays.
  `open` raises the entry again.
  A call that is not open is held by nothing.
  A released turn removes a held entry once (the review of 2026-10-06).

## Verified

- `packages/sdk/test/host-tools.test.ts` 45 cases and `packages/sdk/test/clientcalls.test.ts` 17, all passing.
- `packages/agent-claude` 198 cases in 22 files, all passing.
- `npx vitest run packages/sdk` 1514 cases in 106 files, all passing.
- `npx tsc -b` green, `pnpm boundary` green.
- Each case was run before the code it tests, and seen to fail for its own reason.
  The reasons were no entry raised, the answer refused, the wait unbounded, the image dropped to text, and the handler taking the other call.
  The review's cases were run the same way, and seen to fail.
  Three timed out at 5 s with the opening taken out.
  The stopped-turn case timed out with `releaseCalls` cut to the release alone (the review of 2026-10-06).
- The by-hand run the plan asks for is not done.
  It would use a live CLI with a client tool, to see whether `claudecode/toolUseId` arrives on every call.
  See [deferred.md](deferred.md).

## Departures from the plan

- None of the plan's decisions were changed.
  Two things the plan did not spell out were resolved from the code its refs name.
  The session waits for the frame that opens a call whose id a handler already knows.
  The handler and the frame are two frames, and either can be read first.
  The fallback's warning is a `console.warn`, which is what `packages/agent-pi` does with the one other message of this kind in the backends.
- One case the plan lists reads differently than it was written.
  The pairing cases put the handlers in the other order from the frames.
  Two identical calls opened in one frame and claimed in the same order are told apart by the input match by accident.
  The case would have passed before the fix.
- The plan's `Watch out for` line says a call `canUseTool` asks about is not running until approved.
  The build did not meet it.
  Where the frame came first, the entry went up before the person was asked.
  Where the gate came first, the call never opened, and the handler hung for ever.
  The review of 2026-10-06 found both, and the fix is in the bullets above.

## Left for later

- The live CLI check, and the question it answers - whether the name-and-input fallback can go.
  Both are in [deferred.md](deferred.md).
- p3 and p4: pi and cofold onto the same holder, and an ACP agent's client calls through the tool server.
