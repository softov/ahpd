---
title: A stop with no turn running is refused
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1164-L1213](../../../../packages/sdk/src/host/chatactions.ts#L1164-L1213) - the stop on a lead chat and on a worker chat"
  - "[code://packages/sdk/src/host/chatactions.ts#L481-L505](../../../../packages/sdk/src/host/chatactions.ts#L481-L505) - the wake of a session asleep in the catalogue"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts) - `openSubagent`, which opens a worker chat's held state, reduced from every action said on it"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L353 - `chat/turnCancelled` with no active turn: \"Server MUST reject the action\""
---

## Objective

A `chat/turnCancelled` on a chat that runs no turn is refused with `Nothing is running on <chat> to stop`.
That holds on a lead chat and on the chat of a worker that has ended.
A session asleep in the catalogue gets the refusal without a wake.
A stop naming another turn than a lead chat's running turn stays an echo to its sender alone.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:1164-1213` - read the running turn of the chat the stop names, the worker chat's from its held state, and refuse when there is none.
- `UPDATE: packages/sdk/src/host/chatactions.ts:481-505` - refuse a stop on a session asleep in the catalogue before the wake.
- `UPDATE: packages/sdk/test/host-catalogue.test.ts:656-685` - the stop with no turn running is refused to its sender alone, whatever turn it names.
- `UPDATE: packages/sdk/test/subagent-chat.test.ts` - a stop on a worker chat whose worker has ended is refused and stops nothing; one while the worker runs still stops it.
- `UPDATE: packages/sdk/test/session-wake.test.ts` - a stop on a sleeping session is refused and starts no backend.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts` - `REFUSALS` holds the refusal of `chat/turnCancelled`, with the validation row as its source, and case 015 lists no divergence.

## Steps

1. Write the tests, and run them on `c7899eff` to see each fail for the reason it names.
2. Read the running turn of the chat that the stop names, from its held state for a worker chat.
3. Refuse the stop when that chat runs no turn.
4. Refuse a stop on a session asleep in the catalogue before the wake.
5. Add the `chat/turnCancelled` row to the case driver's `REFUSALS`, and remove case 015 from `DIVERGES`.
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

Built 2026-11-01 in `b945ba52`, on the held-state plan's branch.

- The stop reads a worker chat's turn from its held state, and the backend's `chatState` for any other chat's.
- A refusal names the chat the stop was sent on, so a stop sent on a session channel names the session.
- A worker chat's stop still takes the worker by its call, whatever turn the stop names, as the plan keeps it.
- A worker that runs after its lead turn, on a backend with no `stopWorker`, is still refused with the lead chat's words.
- The busy fake in `subagent-chat.test.ts` gained an optional `stopWorker`, the asking fake's pattern.
