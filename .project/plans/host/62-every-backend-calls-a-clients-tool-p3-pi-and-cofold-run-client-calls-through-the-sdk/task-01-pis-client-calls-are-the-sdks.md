---
title: pi's client calls are the sdk's
status: done
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

A pi call to a client's tool opens in the sdk holder at its running ready.
`execute` waits on it, so the entry is raised, and an early answer is kept.
The call times out.
An image the client returns reaches pi's model as an image.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:185-215, 383-410, 975-982, 1145-1180` - the holder in place of `byClient`; `open` beside the ready for an owned call; `entries()` in the snapshot; the members from `calls.methods`.
- `UPDATE: packages/agent-pi/src/tools.ts:28-60` - `RunByClient` waits on `calls.wait(toolCallId)` and answers `ClientCallAnswer`; `execute` returns text blocks as `TextContent`, an `image/*` embedded resource as `ImageContent`, and anything else as a text line naming its type.
- `UPDATE: packages/agent-pi/test/agent-pi-tools.test.ts` - the cases below.

## Steps

1. Write the cases first and see them fail.
2. Swap the map for the holder with `Start.clientToolTimeoutMs`; release on cancel and close as today.

## Validation

- `packages/agent-pi/test/agent-pi-tools.test.ts`, written first:
  - See a client call raise one `toolClientExecution` entry and remove it when answered.
  - Have the owner answer between the ready and `execute`, and see `execute` get that answer.
  - Provide `openFile` from two clients.
  - Check only the owner of `a__openFile` settles it.
  - Leave a call unanswered and see it fail at the timeout, with the message pi's model reads.
  - Answer with a text and a PNG block, and check `execute` returns a `TextContent`.
  - Check the `ImageContent` carries the same data and mime type.
  - Answer with a PDF block and check it becomes a text line.
  - Keep pi/02's existing cases green.
- `vitest run packages/agent-pi` green.

## Resume

- **Done:** `packages/agent-pi/src/session.ts` holds its client calls in one `createClientCalls`.
  It is built over the session's own `emit`, `start.clientToolTimeoutMs` and a `providers` read from `built`.
  So a gone client's failure can name the other clients that have the tool.
  `openClientCall` asks the owner at the running ready in `askBefore`.
  It asks at the approval too, for a call the person is asked about first.
  So a client is never asked to run a call nobody has allowed.
  `byClient` and `releaseCalls` are gone.
  Cancel and close call `calls.release`, and `toolCallOwner`, `completeToolCall` and `clientGone` are the holder's.
  The snapshot's `inputNeeded` is `needed()`: `pending`'s entries and `calls.entries()`.
  `packages/agent-pi/src/tools.ts` waits on `calls.wait(toolCallId)` and answers `ClientCallAnswer`.
  `toPiContent` maps a text block to a `TextContent`.
  It maps an `image/*` embedded resource to an `ImageContent` with the same data and mime type.
  Anything else becomes a text line `[<contentType>, <n> bytes]`.
  An answer with no blocks becomes the client's own words.
- **Failed first:** seven new cases in `packages/agent-pi/test/agent-pi-tools.test.ts` were each seen to fail for its own reason.
  No entry was raised: `expected [] to have a length of 1`.
  The early answer was refused: `execute` waited for ever and the case timed out.
  The no-timeout case failed the same way, at 5 s.
  The image was dropped to text: `expected [ Array(1) ] to deeply equal [...]`.
  The gone message was the old one: `expected ... 'The client that provides this tool is no longer here'`.
  Three cases `pi/02` left behind had to be changed rather than kept as they were.
  They called `execute` without the ready, which is an order pi never uses (see below).
- **The case order is the fix, not a detail.**
  pi raises `tool_execution_start` and calls the extension's `tool_call` hook *before* it runs the tool.
  So a case that calls `execute` alone has no call to wait on, and the holder rightly refuses it.
  Those cases now use `driveCall(pi, id, name, input)`, pi's own order, already in the fake.
  The tool is taken from `pi.opens[0].tools`.
- **The gone message changed with the holder:** it is now `The client editor that was running open is no longer here` rather than pi's old `The client that provides this tool is no longer here`.
  The holder names the client and the tool, which is more than the old one said; cofold's case checks only `to contain 'no longer here'` and stays green.
- **One case beyond the plan's list:** a client's tool that writes, in `default` mode, is asked about first.
  A case pins that the client is asked only after the person allows it.
  That is the path the plan did not name, and the one branch that would otherwise be silent.
- **Verification:** `npx vitest run packages/agent-pi` green, 168 cases in 11 files (`agent-pi-tools.test.ts` 27); `npx tsc -b` green; `pnpm boundary` green.
- **Next action:** task 02, cofold, in this plan.
