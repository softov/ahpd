---
title: pi and cofold run their client calls through the sdk - implemented
date: 2026-10-06
refs:
  - git://build/agents/8cd9a284
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts)"
  - "[code://packages/agent-pi/src/tools.ts](../../../../packages/agent-pi/src/tools.ts)"
  - "[code://packages/agent-pi/test/agent-pi-tools.test.ts](../../../../packages/agent-pi/test/agent-pi-tools.test.ts)"
  - "[code://packages/agent-cofold/src/turnagent.ts](../../../../packages/agent-cofold/src/turnagent.ts)"
  - "[code://packages/agent-cofold/src/session.ts](../../../../packages/agent-cofold/src/session.ts)"
  - "[code://packages/agent-cofold/test/agent-cofold-client-tool.test.ts](../../../../packages/agent-cofold/test/agent-cofold-client-tool.test.ts)"
---

pi's and cofold's calls to their clients' tools are the sdk's now, which is what the other two backends already were.
Each call is raised on the session as the protocol's `toolClientExecution` entry.
A client that runs its tools from `inputNeeded` finds one, and not only a client watching the chat.
The entry goes when the answer does.

A call nobody answers fails in the time the host allows, rather than blocking the turn for ever.
The answer reaches the model as well as it can be carried.
pi hands its model the client's images as images, and anything else as a line naming it.
cofold's tools answer text only, so it hands its model the client's words and a line for every block it could not pass.

## What was built

- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - one `createClientCalls` per session, over the session's own `emit`, `start.clientToolTimeoutMs` and a `providers` read from the tools built for the turn.
  So a gone client's failure names the other clients that have the same tool.
  `byClient` and `releaseCalls` are gone.
  `toolCallOwner`, `completeToolCall` and `clientGone` are the holder's, and cancel and close call `calls.release`.
  `openClientCall` asks the owner at the running ready in `askBefore`.
  It asks at the approval too, for a call the person is asked about first.
  So a client is never asked to run a call nobody has allowed.
  The snapshot's `inputNeeded` is the person's requests and `calls.entries()`.
- [`code://packages/agent-pi/src/tools.ts`](../../../../packages/agent-pi/src/tools.ts) - `RunByClient` answers a `ClientCallAnswer`.
  `toPiContent` maps a text block to a `TextContent`.
  It maps an `image/*` embedded resource to an `ImageContent` with the same data and mime type.
  Anything else becomes a text line `[<contentType>, <n> bytes]`.
  An answer with no blocks becomes the client's own words.
- [`code://packages/agent-cofold/src/turnagent.ts`](../../../../packages/agent-cofold/src/turnagent.ts) - the same holder.
  The ask and the wait are one step in `relay.call`, which is a departure from the plan (see below).
  `readOf` gives cofold's model the client's words and then a line per block that is not text.
- [`code://packages/agent-cofold/src/session.ts`](../../../../packages/agent-cofold/src/session.ts) - the snapshot's `inputNeeded` is the person's requests and `calls.entries()`.
- [`code://packages/agent-pi/test/agent-pi-tools.test.ts`](../../../../packages/agent-pi/test/agent-pi-tools.test.ts) - eight new cases, and three older ones corrected to pi's real order.
  pi raises `tool_execution_start` and calls the extension's `tool_call` hook before it runs the tool.
  So a case that called `execute` alone was calling it in an order pi never uses.
- [`code://packages/agent-cofold/test/agent-cofold-client-tool.test.ts`](../../../../packages/agent-cofold/test/agent-cofold-client-tool.test.ts) - four new cases beside the six that were already there.

## Verified

- `npx vitest run packages/agent-pi` green, 168 cases in 11 files (`agent-pi-tools.test.ts` 27).
- `npx vitest run packages/agent-cofold` green, 191 cases in 15 files (`agent-cofold-client-tool.test.ts` 10).
- `npx tsc -b` green, `pnpm boundary` green.
- Every new case was run before the code it tests and seen to fail for its own reason.
  pi's seven were seen against the old session.
  No entry was raised: `expected [] to have a length of 1`.
  The answer that arrives before `execute` was refused: the case waited for ever.
  No timeout failed the same way, at 5 s.
  The image dropped to text, and the old gone message was there.
  cofold's four were seen by breaking the finished holder in three places.
  The open was made a no-op, `readOf` returned the text alone, and the timeout was not passed on.
  No entry: `expected [] to have a length of 1 but got +0`.
  No call held for either of two clients: `expected undefined to match object { clientId: 'a' }`.
  The wait refused a call nobody held: `call-1 is not a call a client is running here`.
  The blocks were dropped.
- cofold's six older cases failed first against the new holder, which is what found the departure below.

## Departures from the plan

- The plan's architecture said cofold "opens where `toolReadyAction` goes out for an owned call and waits in the relay".
  Its files list said the open goes beside the running ready in `tools.ts`.
  That cannot work.
  `@cofold/agents` emits `tool.started` and runs the tool without yielding to this host's reader.
  So the relay is asked before the host has read the event that says the call is running.
  A call opened from that event is opened after the tool has already asked for it.
  The open moved into the relay, where the ask and the wait are one step.
  Waiting for the mapping's open instead would need the entry's arrival raced against the turn's end, or a stopped turn hangs a tool for ever.
  The table row, the architecture line and the task's Files line are amended to what the code does.
- One case the plan lists is not reachable in cofold: "the owner answers before the relay is asked".
  Nothing can answer before an ask that happens a tick after the call starts - the failure above is the proof rather than an argument.
  The property itself is the holder's, pinned in [`code://packages/sdk/test/host-tools.test.ts`](../../../../packages/sdk/test/host-tools.test.ts).
  It is reachable in pi, where the ready goes out before the tool runs.
  pi's case `keeps the answer a client gives between the ready and the run` pins it per backend.
- No decision in the plan's tables was changed, and none of the parent's.

## Left for later

- Nothing. p4 - an ACP agent's client calls - is the parent's, not this plan's.
