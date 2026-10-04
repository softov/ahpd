---
title: The listing throttle goes
status: todo
depends: [task-01-pi-finds-a-session-by-id.md, task-02-cofold-finds-a-session-by-id.md, task-03-acp-finds-a-session-by-listing-its-own-server.md]
layer: "sdk, docs"
refs:
  - "[code://packages/sdk/src/host/history.ts#L10-L20](../../../../packages/sdk/src/host/history.ts#L10-L20) - `LISTING_FRESH`, which goes"
  - "[code://packages/sdk/src/host/history.ts#L141-L142](../../../../packages/sdk/src/host/history.ts#L141-L142) - `pastAt`, which goes"
  - "[code://packages/sdk/src/host/history.ts#L158-L171](../../../../packages/sdk/src/host/history.ts#L158-L171) - `refresh`, the single flight"
  - "[code://packages/sdk/src/host/history.ts#L183-L194](../../../../packages/sdk/src/host/history.ts#L183-L194) - `relist`, which today waits out any running refresh"
  - "[code://packages/sdk/src/host/history.ts#L218-L225](../../../../packages/sdk/src/host/history.ts#L218-L225) - `someCannotSay`"
  - "[code://packages/sdk/src/host/history.ts#L265-L278](../../../../packages/sdk/src/host/history.ts#L265-L278) - the throttled fallback in `past`"
  - "[code://packages/sdk/test/users-gate.test.ts#L1132-L1146](../../../../packages/sdk/test/users-gate.test.ts#L1132-L1146) - `listingOne`, a backend with `list` and no `find`"
  - "[code://packages/sdk/test/users-gate.test.ts#L1169-L1175](../../../../packages/sdk/test/users-gate.test.ts#L1169-L1175) - `finds a session a backend wrote to disk after the last listing`"
  - "[code://packages/sdk/test/users-gate.test.ts#L1215-L1229](../../../../packages/sdk/test/users-gate.test.ts#L1215-L1229) - `reads the catalogue once for a run of subscribes to sessions nobody has`"
  - "[code://packages/sdk/test/host-past-open.test.ts#L139-L152](../../../../packages/sdk/test/host-past-open.test.ts#L139-L152) - the `find`-less fallback test host 56 wrote"
  - "[code://docs/AGENT.md#L84](../../../../docs/AGENT.md#L84) - the `Agent` table"
---

## Objective

With every bundled agent answering `find`, `past` never lists for them; a third-party agent that lists without `find` gets one refresh per missing id, started after the id was asked for, with no time window of its own.

## Files

- `UPDATE: packages/sdk/src/host/history.ts:10-20` - `LISTING_FRESH` and its comment deleted.
- `UPDATE: packages/sdk/src/host/history.ts:141-142` - `pastAt` deleted; `started`, a count of refreshes begun, added beside `refreshing`, and `refresh` bumps it when it starts one.
- `UPDATE: packages/sdk/src/host/history.ts:183-194` - `relist(asked)`: joins the running refresh when it began after `asked`, and otherwise waits it out and calls `refresh()`.
- `UPDATE: packages/sdk/src/host/history.ts:218-225` - `someCannotSay` counts an agent with `list` and no `find`.
- `UPDATE: packages/sdk/src/host/history.ts:265-278` - the fallback runs whenever the row is still missing and `someCannotSay()`, with `relist` given the `started` count read when `past` began.
- `UPDATE: packages/sdk/test/users-gate.test.ts:1169-1175, 1215-1229` - the two tests below; in `users-gate-sessions.test.ts` instead if host 55 has landed.
- `UPDATE: docs/AGENT.md:84` - a `find(id)` row after `list()`: one session's row without listing the rest, and without it a missing id costs a listing; the file is hard-wrapped, so the row matches it.

## Steps

1. Write the users-gate tests below first and see the first one fail on the throttle.
2. Delete `LISTING_FRESH` and `pastAt`, and the `Date.now() - pastAt` condition with them.
3. Add `started` and make `relist` take the count its caller read before it asked anyone anything; a refresh numbered above it began after the ask, so it is joined, and one at or below it is waited out and followed by a new one.
4. Narrow `someCannotSay` to agents with `list` and no `find`.
5. Rewrite the comments on `relist` and the fallback to say what they are now, with no mention of the window that went.
6. Add the `find(id)` row to `docs/AGENT.md`.

How this stays safe for a session written to disk after the last listing:

- A subscribe arrives after the session was written, so any refresh that began after the subscribe read the disk after the write and has the row.
- `relist` only ever answers from such a refresh: it joins one that began after the ask, and for one that began before it waits and starts its own.
- The throttle was the only path that answered from an older listing, and it is the part that goes.
- For the bundled agents the question does not arise, because each `find` reads its store at the time it is asked: Claude's `getSessionInfo`, pi's `findById`, cofold's `sessions.get`, ACP's `session/list`.

## Validation

- `users-gate.test.ts`, with `listingOne` unchanged (it has no `find`):
  - `reads the catalogue once for a run of subscribes to sessions nobody has` becomes `shares one listing among subscribes to sessions nobody has, asked at once`: five subscribes in one `Promise.all`, and `counted.lists - before` is 1; the fake timers go, since there is no window to step past.
  - a new `finds a session written between two subscribes, however close together`: subscribe to `claude:/nobody`, push `onDisk('late')`, subscribe to `claude:/late` at once, and it opens; this one fails first, because today the second subscribe is inside `LISTING_FRESH` and answers -32001.
  - `finds a session a backend wrote to disk after the last listing` gains a second half: `list` held on a promise the test releases, `onDisk('late2')` pushed while that listing runs, a subscribe to `claude:/late2` sent before the release, and it opens; this guards against `relist` joining a refresh that began before the ask.
- `host-past-open.test.ts`: a host whose only agent has `list` and `find` lists nothing when an id nobody has is opened five times in a row; the existing `find`-less fallback test still passes.
- `rg -n "LISTING_FRESH|pastAt" packages` finds nothing.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test`.

## Resume
