---
title: pi's client calls are the sdk's
status: todo
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L185-L215](../../../../packages/agent-pi/src/session.ts#L185-L215) - the map that goes"
  - "[code://packages/agent-pi/src/session.ts#L383-L410](../../../../packages/agent-pi/src/session.ts#L383-L410) - where the running ready goes out"
  - "[code://packages/agent-pi/src/session.ts#L975-L982](../../../../packages/agent-pi/src/session.ts#L975-L982) - the snapshot's `inputNeeded`"
  - "[code://packages/agent-pi/src/session.ts#L1145-L1180](../../../../packages/agent-pi/src/session.ts#L1145-L1180) - the three members that go"
  - "[code://packages/agent-pi/src/tools.ts#L28-L60](../../../../packages/agent-pi/src/tools.ts#L28-L60) - `RunByClient`"
  - "[code://packages/agent-pi/test/agent-pi-tools.test.ts](../../../../packages/agent-pi/test/agent-pi-tools.test.ts) - the cases to keep and extend"
---

## Objective

A pi call to a client's tool is opened in the sdk holder at its running ready and waited on in `execute`, so the entry is raised, an early answer is kept, the call times out, and an image the client returns reaches pi's model as an image.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:185-215, 383-410, 975-982, 1145-1180` - the holder in place of `byClient`; `open` beside the ready for an owned call; `entries()` in the snapshot; the members from `calls.methods`.
- `UPDATE: packages/agent-pi/src/tools.ts:28-60` - `RunByClient` waits on `calls.wait(toolCallId)` and answers `ClientCallAnswer`; `execute` returns text blocks as `TextContent`, an `image/*` embedded resource as `ImageContent`, and anything else as a text line naming its type.
- `UPDATE: packages/agent-pi/test/agent-pi-tools.test.ts` - the cases below.

## Steps

1. Write the cases first and see them fail.
2. Swap the map for the holder with `Start.clientToolTimeoutMs`; release on cancel and close as today.

## Validation

- `packages/agent-pi/test/agent-pi-tools.test.ts`, written first:
  - a client call raises one `toolClientExecution` entry and removes it when answered.
  - the owner answers between the ready and `execute`, and `execute` gets that answer.
  - two clients providing `openFile`: only the owner of `a__openFile` settles it.
  - an unanswered call fails at the timeout with the message pi's model reads.
  - a client answering with a text and a PNG block: `execute` returns a `TextContent` and an `ImageContent` with the same data and mime type; a PDF block becomes a text line.
  - pi/02's existing cases stay green.
- `vitest run packages/agent-pi` green.

## Resume
