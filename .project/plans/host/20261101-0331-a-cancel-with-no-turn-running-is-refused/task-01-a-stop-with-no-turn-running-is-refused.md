---
title: A stop with no turn running is refused
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1164-L1213](../../../../packages/sdk/src/host/chatactions.ts#L1164-L1213) - the stop on a lead chat and on a worker chat"
  - "[code://packages/sdk/src/host/chatactions.ts#L481-L505](../../../../packages/sdk/src/host/chatactions.ts#L481-L505) - the wake of a session asleep in the catalogue"
  - "[code://packages/sdk/src/host/spawn.ts#L375-L381](../../../../packages/sdk/src/host/spawn.ts#L375-L381) - a worker chat's state, reduced from every action said on it"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L353 - `chat/turnCancelled` with no active turn: \"Server MUST reject the action\""
---

## Objective

A `chat/turnCancelled` on a chat that runs no turn is refused with `Nothing is running on <chat> to stop`.
That holds on a lead chat and on the chat of a worker that has ended.
A session asleep in the catalogue gets the refusal without a wake.
A stop naming another turn than a lead chat's running turn stays an echo to its sender alone.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:1164-1213` - read the running turn of the chat the stop names, the worker chat's from `subagents`, and refuse when there is none.
- `UPDATE: packages/sdk/src/host/chatactions.ts:481-505` - refuse a stop on a session asleep in the catalogue before the wake.
- `UPDATE: packages/sdk/test/host-catalogue.test.ts:656-685` - the stop with no turn running is refused to its sender alone, whatever turn it names.
- `UPDATE: packages/sdk/test/subagent-chat.test.ts` - a stop on a worker chat whose worker has ended is refused and stops nothing; one while the worker runs still stops it.
- `UPDATE: packages/sdk/test/session-wake.test.ts` - a stop on a sleeping session is refused and starts no backend.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts` - `REFUSALS` holds the refusal of `chat/turnCancelled`, with the validation row as its source.

## Steps

1. Write the tests, and run them on `c7899eff` to see each fail for the reason it names.
2. Read the running turn of the chat that the stop names, from `subagents` for a worker chat.
3. Refuse the stop when that chat runs no turn.
4. Refuse a stop on a session asleep in the catalogue before the wake.
5. Add the `chat/turnCancelled` row to the case driver's `REFUSALS`.
6. Run the tests again, and the protocol cases.

## Validation

- `host-catalogue.test.ts`: the host refuses a stop with no turn running, whatever turn it names.
- `host-catalogue.test.ts`: the refusal reaches its sender alone.
- `subagent-chat.test.ts`: the host refuses a stop on the chat of an ended worker, and calls no `stopWorker`.
- `subagent-chat.test.ts`: a stop while the worker runs still reaches `stopWorker`.
- `session-wake.test.ts`: the host refuses a stop on a sleeping session and starts no backend.
- `ahp-test-cases.test.ts`: the host refuses case 015 with the reason the new row names.
- `ahp-test-cases.test.ts`: every protocol case passes.

## Resume
