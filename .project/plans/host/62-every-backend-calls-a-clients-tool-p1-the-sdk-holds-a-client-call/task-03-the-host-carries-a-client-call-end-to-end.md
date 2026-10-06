---
title: The host carries a client call end to end
status: done
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

- **Done:** seven cases in a new `a client's call, held by the backend` describe in `packages/sdk/test/host-tools.test.ts`, run against an `echo` backend whose `create` opens and waits through `createClientCalls`, spreads its `methods` onto the `Session`, reports `status()` and puts `entries()` in its `snapshot.state.inputNeeded`. `packages/sdk/src/host/chatactions.ts` hands `chat/toolCallComplete`'s content blocks through whole instead of reading them down to text; `packages/sdk/src/types/session.ts` `completeToolCall` takes `ClientCallAnswer`; `packages/sdk/src/types/host.ts` and `packages/sdk/src/types/agent.ts` carry `clientToolTimeoutMs`, resolved by the host in `packages/sdk/src/host/spawn.ts` (`options.clientToolTimeoutMs ?? DEFAULT_CLIENT_TOOL_TIMEOUT_MS`, so `Start.clientToolTimeoutMs` is a number and not an optional one); `packages/server/src/config.ts` and `packages/server/src/commands/options.ts` declare the daemon key, and `packages/server/src/commands/run.ts` hands it over only when the deployment set it; `packages/sdk/src/types/events.ts` says what an `input_needed_set` of kind `toolClientExecution` is. 34 cases in the file, all passing.
- **Failed first:** the cases were written before any of that, and three of the seven failed on it - `hands the whole answer to the backend, content blocks and all` (`expected [] to deeply equal [{ type: 'text', text: 'here it is' }, { type: 'embeddedResource', … }]`, because `chatactions.ts` read `result.content` down to its text), `gives every session ten minutes unless the host says otherwise` (`expected [undefined, undefined, undefined] to deeply equal [600000, 0, 1500]`, because nothing handed the option to `Start`), and `fails a call nobody answers in the time the host allows` (timed out at 5000 ms, because `clientToolTimeoutMs: 50` never reached the holder and its own ten-minute default outlived the fake clock).
- **Each step seen to fail on its own:** handing `content: []` in `chatactions.ts` failed 1 case; dropping the option from the `Start` in `spawn.ts` failed 2.
- **Three of those first failures were mine, not the code's:** the entry's `chat` is respelled for whoever reads it (`host/routing.ts:224-229`), so a client's snapshot names the chat it dispatches to while the entry's `id` keeps the backend's own spelling of it; and the status a session is served under is the chat's `status()` rather than its snapshot's, because `host/snapshots.ts:226` asks `statusOf` - `drivingOf` - `leadOf(held).status()`. The cases were corrected and the fake was given a `status()` that reports `InProgress` while a call is out.
- **One fork this task's file list does not settle, left as it is:** the key is set by `config.json` and `--client-tool-timeout-ms`, but it is not in `rootconfig.ts`'s `DAEMON_KEYS`, so it is not one a client edits through root config the way `advancedTools` is - the task names `config.ts` and `options.ts` and not `rootconfig.ts`, and `packages/server/test/server-root-config.test.ts:67` pins that list to exactly eight keys on purpose. Adding it there is the two lines plus that test.
- **Files outside the task's list:** `packages/server/src/commands/run.ts`, without which the option never reaches a host; and every test that builds a `Start` by hand, because the field is required - `agent-acp-blocks`, `agent-acp-catalog`, `agent-acp-delete`, `agent-acp-failure`, `agent-acp-signin`, `agent-acp-usage`, `agent-cofold-compact`, `agent-cofold-delete`, `agent-cofold-fork`, `agent-cofold-store`, `agent-pi-disk`, `agent-pi-fork`, `agent-pi-tools` and two answers in `agent-pi-asking` that now carry `content`.
- **Next action:** nothing; this task is implemented. Every task in the plan is, so the plan's own closing runs next.
