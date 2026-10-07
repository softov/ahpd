---
title: cofold's client calls are the sdk's
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/turnagent.ts#L115-L150](../../../../packages/agent-cofold/src/turnagent.ts#L115-L150) - `waiting` and the relay that go"
  - "[code://packages/agent-cofold/src/turnagent.ts#L229-L285](../../../../packages/agent-cofold/src/turnagent.ts#L229-L285) - the three members that go"
  - "[code://packages/agent-cofold/src/tools.ts#L240-L300](../../../../packages/agent-cofold/src/tools.ts#L240-L300) - where the running ready goes out"
  - "[code://packages/agent-cofold/src/session.ts#L255-L262](../../../../packages/agent-cofold/src/session.ts#L255-L262) - the snapshot's `inputNeeded`"
  - "[code://packages/agent-cofold/src/pauses.ts#L155-L165](../../../../packages/agent-cofold/src/pauses.ts#L155-L165) - `releaseCalls` at the turn's end"
  - "[code://packages/agent-cofold/test/agent-cofold-client-tool.test.ts](../../../../packages/agent-cofold/test/agent-cofold-client-tool.test.ts) - the six cases to keep and extend"
---

## Objective

A cofold call to a client's tool is opened in the sdk holder at its running ready.
The relay waits on it, so the entry is raised, and an early answer is kept.
The call times out.
A client's image or resource is named in the text cofold's model reads.
That is because a cofold tool answers text only.

## Files

- `UPDATE: packages/agent-cofold/src/turnagent.ts:115-150, 229-285` - the holder in place of `waiting`; the relay's `call` opens the call and then waits on it, and its text is the answer's text plus one line per non-text block, `[image/png, <n> bytes]`; the members from `calls.methods`; a failed answer still rejects so cofold records a failed `tool.completed`.
- `NO CHANGE: packages/agent-cofold/src/tools.ts:240-300` - where this was to open, beside the running ready. It cannot: cofold runs the tool without yielding to this host's reader, so the ask belongs in the relay. See *Resume*.
- `UPDATE: packages/agent-cofold/src/session.ts:255-262` - `entries()` in the snapshot.
- `UPDATE: packages/agent-cofold/test/agent-cofold-client-tool.test.ts` - the cases below.

## Steps

1. Write the cases first and see them fail.
2. Swap the map for the holder with `Start.clientToolTimeoutMs`; release at turn end, cancel and close as today.

## Validation

- `packages/agent-cofold/test/agent-cofold-client-tool.test.ts`, written first:
  - See a client call raise one `toolClientExecution` entry and remove it when answered.
  - Have the owner answer before the relay asks, and check the model's next step carries that answer.
  - Provide `openFile` from two clients, and check only the owner of `a__openFile` settles it.
  - Leave a call unanswered and see it fail at the timeout, with the run finishing.
  - Answer with a text and a PNG block, and check the model's next step.
  - Check it carries the text and the `[image/png, <n> bytes]` line.
  - Keep the six existing cases green.
- `vitest run packages/agent-cofold` green.

## Resume

- **Done:** `packages/agent-cofold/src/turnagent.ts` holds its client calls in one `createClientCalls`.
  It is built over the session's own emit, `start.clientToolTimeoutMs` and a `providers` read from `ctx.offered`.
  So a gone client's failure can name the other clients that have the tool.
  `WaitingCall`, `waiting` and the hand-rolled relay map are gone.
  The ask and the wait are one step in `relay.call`, which opens the call through `openedCall` and then waits on `calls.wait`.
  So a failed answer still throws, and cofold still records a failed `tool.completed`.
  `readOf` gives cofold's model, whose tools answer text only, the client's own words.
  Then it gives one line per block that is not text.
  An embedded resource becomes `[<contentType>, <n> bytes]`, and anything else the block itself.
  The session snapshot's `inputNeeded` is `ctx.needed()` - the person's requests and `calls.entries()` - and `toolCallOwner`, `completeToolCall` and `clientGone` are the holder's.
  Nothing in `tools.ts` changed: see below.
- **Failed first:** the four new cases in `packages/agent-cofold/test/agent-cofold-client-tool.test.ts` were each seen to fail before the holder was wired in.
  The implementation was broken deliberately in three places: the open made a no-op, `readOf` returning the text alone, and the timeout not passed on.
  `expected [] to have a length of 1 but got +0`: no entry.
  `expected undefined to match object { clientId: 'a' }`: no call held for either client.
  `expected 'call-1 is not a call a client is runn…' to contain 'got no answer from probe'`: no timer, and the relay's wait refused the call.
  `to contain 'here is the page'`: blocks dropped.
  The plan says the cases come first.
  The sequence here was the other way round for the six that already existed.
  They failed against the new holder first, which is what found the fork below.
  The four were seen to fail before it was finished.
- **The plan's architecture did not survive contact with cofold's run loop.**
  The plan says cofold "opens where `toolReadyAction` goes out for an owned call and waits in the relay".
  The files list says `tools.ts:240-300 - open beside the running ready`.
  That cannot work.
  cofold's `run/tools.js` emits `tool.started` and then calls `tool.execute` without yielding to this host's reader.
  So the relay is asked *before* the host has read the event that says the call is running.
  With the open at the running ready, five of the six existing cases failed with `call-1 is not a call a client is running here`.
  Opening in the relay instead is the only order in which the wait finds its call.
  That puts the ask and the wait in the same turn of the loop.
  The architecture line and the Files line in `plan.md` are amended to what the code now does.
  The alternative is to make the relay wait for the mapping's open.
  That needs the entry's arrival to be raced against the turn's end.
  Otherwise a stopped turn hangs a tool for ever, which is the hang the holder exists to prevent.
- **One case of the plan's list is not reachable here:** "the owner answers before the relay is asked". Nothing can answer before an ask that happens a tick after the call starts, and the failure above is the proof rather than an argument.
  What that case is about is the holder's own property: an answer arriving before the wait, and being found rather than refused.
  That is pinned in `packages/sdk/test/host-tools.test.ts`.
  It is reachable in pi, whose ready goes out before the tool runs.
  pi's case `keeps the answer a client gives between the ready and the run` pins it per backend.
- **Two cases beyond the plan's list, and one narrowed:** the two-client case also pins that both tools are on the model's list.
  It pins that the refused client is refused in the host's own words (`rejectionReason`).
  The entry case pins the entry's shape: `kind`, `chat`, `turnId`, `clientId`, and a `toolCall`.
  That `toolCall` is named as the client announced it: `openFile`, not `probe__openFile`.
  The plan's "the model's next step carries that answer" is already the fourth existing case.
  So the new cases do not repeat it.
- **Verification:** `npx vitest run packages/agent-cofold` green, 191 cases in 15 files (`agent-cofold-client-tool.test.ts` 10); `npx tsc -b` green; `pnpm boundary` green.
- **Next action:** the plan is finished with this task; `implemented.md` is written and the plan is `built`.
