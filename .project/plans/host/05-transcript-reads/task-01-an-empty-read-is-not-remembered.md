---
title: An empty read is not remembered
status: todo
depends: []
layer: host
refs:
  - code://packages/sdk/src/host.ts#L3772 - `history`, the map the empty answer is kept in
  - code://packages/sdk/src/host.ts#L3790-L3825 - `past`, where the write is
  - code://packages/sdk/src/host.ts#L3899 - the annotations probe that must keep seeing a known session
  - code://packages/sdk/src/host.ts#L6366-L6428 - the seeds that must keep seeing a known session
  - code://test/host.test.ts#L32-L85 - the SDK mock and its `sdk.reads` counter
  - code://test/host.test.ts#L2324-L2380 - the transcript describe the new case joins
  - code://test/host.test.ts#L6140-L6161 - the one-read-per-open case that must stay green
---

## Objective

A session whose transcript answered no turns is read again the next time it is opened, instead of serving that empty answer for the life of the host process, and a transcript that has turns is still read only once.

## Files

- `UPDATE: packages/sdk/src/host.ts:3816-3820` - `past` stores the read only when it has turns; today it stores whatever the port answered, and an empty array is truthy, so the cache keeps it.
- `UPDATE: test/host.test.ts` - one case in the `a session read from its transcript` describe: an empty read is repeated, and a read with turns is not.

## Steps

1. In `past`, wrap the write as `if (built.length > 0) history.set(id, built);` and leave the `return built` where it is, so the answer's shape does not change.
2. Say in the comment above it what the rule is for: an empty answer is what a failure and a session with nothing in it both look like from this port, and keeping it is what makes one bad read permanent; a read with turns is the 35MB case the cache exists for.
3. Add the case: subscribe to a chat whose transcript is empty and assert no turns and one read, write a user frame into the mock, subscribe again and assert the turn arrives and the read count moved to two, then subscribe a third time and assert the count did not move.
4. Run `pnpm test`, `pnpm typecheck` and `pnpm boundary`.

## Validation

- `test/host.test.ts` - the new case, and the existing `reads the transcript once, however many channels ask for it at once` still at one read.
- `test/host.test.ts` - the annotations and seed cases still open a catalogue session, which is the half that would break if empty became `undefined` instead.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- By hand: open a session whose transcript is empty, add a turn to the file, and open it again in the window; the turn is drawn without restarting anything.

## Resume

Done 2026-09-23.
`past` wraps the write as `if (built.length > 0) history.set(id, built);`, with the comment that says why: an empty answer is what a failure and a session with nothing in it both look like from the port, and keeping it makes one bad read permanent.
The case covers all three halves in one place: an empty read is repeated, a read with turns is served, and a third open does not read at all.
