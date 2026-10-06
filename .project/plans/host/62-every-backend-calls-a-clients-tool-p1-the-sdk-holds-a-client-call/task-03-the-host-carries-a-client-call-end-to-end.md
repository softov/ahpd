---
title: The host carries a client call end to end
status: todo
depends: [task-01-a-client-call-is-held-in-one-place.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/test/host-tools.test.ts#L527-L753](../../../../packages/sdk/test/host-tools.test.ts#L527-L753) - today's client-tool cases through `createHost`"
  - "[code://packages/sdk/src/host/chatactions.ts#L1072-L1100](../../../../packages/sdk/src/host/chatactions.ts#L1072-L1100) - the result read down to text, which now keeps its content"
  - "[code://packages/sdk/src/types/session.ts#L459-L463](../../../../packages/sdk/src/types/session.ts#L459-L463) - `completeToolCall`'s result type"
  - "[code://packages/sdk/src/host.ts#L658-L679](../../../../packages/sdk/src/host.ts#L658-L679) - `leaves` calls `clientGone` then `retool`"
  - "[code://packages/sdk/src/host/spawn.ts#L527-L548](../../../../packages/sdk/src/host/spawn.ts#L527-L548) - the `input_needed_set` event"
  - "[code://packages/sdk/src/types/events.ts#L97-L115](../../../../packages/sdk/src/types/events.ts#L97-L115) - its doc, which says a person is being waited on"
  - "[code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts) - `HostOptions`, where the timeout option goes"
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts) - the daemon key beside `advancedTools`"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `awaitsUser` keeps a `toolClientExecution` entry from raising `InputNeeded` (`channels-session/reducer.ts:40-49`)"
---

## Objective

Through `createHost`, a client's `chat/toolCallComplete` reaches the backend with its whole content, and a client call raises its entry on the session, keeps the session `InProgress`, is answered only by its owner when two clients provide the same name, and ends with a failure when its client leaves or the time runs out; the timeout is a daemon option.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:1072-1100` - the answer keeps `result.content` beside the joined text and the error message.
- `UPDATE: packages/sdk/src/types/session.ts:459-463` - `completeToolCall` takes `ClientCallAnswer`.
- `UPDATE: packages/sdk/src/types/host.ts` - `clientToolTimeoutMs` on `HostOptions`, 10 minutes when unset, 0 for no limit, handed to each backend on `Start`.
- `UPDATE: packages/sdk/src/types/agent.ts` - `Start.clientToolTimeoutMs`.
- `UPDATE: packages/sdk/src/host/spawn.ts` - pass it on `Start`.
- `UPDATE: packages/server/src/config.ts`, `packages/server/src/commands/options.ts` - the daemon key `clientToolTimeoutMs`.
- `UPDATE: packages/sdk/src/types/events.ts:97-115` - the doc says a `toolClientExecution` kind is work a client runs, not a person asked.
- `UPDATE: packages/sdk/test/host-tools.test.ts` - the cases below, on a fake backend that uses the holder.

## Steps

1. Write the cases first against a fake backend in the test that opens and waits through `createClientCalls`, and see them fail before task 01.
2. Add the option and pass it down.
3. Correct the event's doc.

## Validation

- `packages/sdk/test/host-tools.test.ts`, written first:
  - two clients announce `openFile`: the backend is offered `a__openFile` and `b__openFile`; a call to `a__openFile` raises an entry with `clientId: a`; `b`'s `chat/toolCallComplete` is refused and `a`'s settles it.
  - the session's summary status reads `InProgress`, not `InputNeeded`, while the entry is open, checked through the protocol's session reducer.
  - the client leaves mid-call: the call fails with the gone text, naming `b__openFile` when `b` still provides it, and the entry is removed.
  - a call with `clientToolTimeoutMs: 50` and fake timers fails with `ok: false` and its entry is removed.
  - `input_needed_set` fires with `kind: 'toolClientExecution'`.
  - a completion with a text and an image block reaches the backend's `completeToolCall` with both in `content`.
  - the daemon option unset gives 600000 ms on `Start`, and 0 passes through.
- `pnpm test`, `pnpm typecheck` green; `pnpm wire` shows `session/inputNeededSet` with the new kind valid.

## Resume
