---
title: cofold's client calls are the sdk's
status: todo
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

A cofold call to a client's tool is opened in the sdk holder at its running ready and waited on through the relay, so the entry is raised, an early answer is kept, the call times out, and a client's image or resource is named in the text cofold's model reads, since a cofold tool answers text only.

## Files

- `UPDATE: packages/agent-cofold/src/turnagent.ts:115-150, 229-285` - the holder in place of `waiting`; the relay's `call` is `calls.wait`, and its text is the answer's text plus one line per non-text block, `[image/png, <n> bytes]`; the members from `calls.methods`; a failed answer still rejects so cofold records a failed `tool.completed`.
- `UPDATE: packages/agent-cofold/src/tools.ts:240-300` - `open` beside the running ready for an owned call.
- `UPDATE: packages/agent-cofold/src/session.ts:255-262` - `entries()` in the snapshot.
- `UPDATE: packages/agent-cofold/test/agent-cofold-client-tool.test.ts` - the cases below.

## Steps

1. Write the cases first and see them fail.
2. Swap the map for the holder with `Start.clientToolTimeoutMs`; release at turn end, cancel and close as today.

## Validation

- `packages/agent-cofold/test/agent-cofold-client-tool.test.ts`, written first:
  - a client call raises one `toolClientExecution` entry and removes it when answered.
  - the owner answers before the relay is asked, and the model's next step carries that answer.
  - two clients providing `openFile`: only the owner of `a__openFile` settles it.
  - an unanswered call fails at the timeout and the run finishes.
  - a client answering with a text and a PNG block: the model's next step carries the text and the `[image/png, <n> bytes]` line.
  - the six existing cases stay green.
- `vitest run packages/agent-cofold` green.

## Resume
