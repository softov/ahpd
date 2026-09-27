---
title: The git watch closes when nobody watches its directory, and a watcher error falls back
status: implemented
depends: [task-04-staging-elsewhere-reaches-the-changeset.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L2760-L2781](../../../../packages/sdk/src/host.ts#L2760-L2781) - `dirWatchers`, `stopWatchingDir`, `startWatchingDir` and `stopUnwatched`"
  - "[code://packages/sdk/src/host.ts#L2685-L2694](../../../../packages/sdk/src/host.ts#L2685-L2694) - `watchedIn`, the one test of whether a directory is worth a watch"
  - "[code://packages/sdk/src/host.ts#L3910](../../../../packages/sdk/src/host.ts#L3910) - a session removed, one of two places"
  - "[code://packages/sdk/src/host.ts#L4012](../../../../packages/sdk/src/host.ts#L4012) - a session removed, the other"
  - "[code://packages/sdk/src/host.ts#L9140-L9163](../../../../packages/sdk/src/host.ts#L9140-L9163) - a connection's `close`, which drops its `watching` without a last unsubscribe"
  - "[code://packages/sdk/src/changes.ts#L1016-L1133](../../../../packages/sdk/src/changes.ts#L1016-L1133) - the source's `watch`, whose every handle has an `error` listener"
---

## Objective

The git watch on a directory is closed as soon as no connection watches a changeset of a session there, whichever way that happens, and a watcher that fails closes itself and leaves the other triggers working, as task 04 step 4 asked.

## Files

- `UPDATE: packages/sdk/src/host.ts` - one check that stops a directory's watch when `watchedIn` is false, called on the last unsubscribe (as today), on a connection's `close`, and where a session is removed.
- `UPDATE: packages/sdk/src/changes.ts:1016-1133` - an `error` listener on every watcher that closes it and calls nothing.
- `UPDATE: packages/sdk/test/changes-refresh.test.ts` - the cases below.

## Steps

1. Put the "stop when nobody watches" check in one function and call it from the three places above; a connection's `close` checks every directory its `watching` named.
2. A removed session whose directory still has another watched session keeps the watch.
3. A worktree removed with its session leaves no entry in `dirWatchers`, so a new session at the same path gets a new watch.
4. In `changes.ts`, `watcher.on('error', ...)` closes the watcher and clears the debounce timer; nothing is thrown and nothing is logged per event.

## Validation

- `changes-refresh.test.ts`, with the `counting` source: a connection that subscribes to the uncommitted changeset and then closes without unsubscribing leaves the source's stop function called.
  Today it is not called until the next git event.
- A session disposed while its changeset is watched by a connection that then does nothing: the stop function is called.
- Two sessions in one directory, one disposed: the watch stays.
- A fake `FSWatcher` error (or `emit('error', ...)` on the real one) closes it and the daemon process does not throw.
- `node_modules/.bin/vitest run packages/sdk/test/changes-refresh.test.ts` green; `pnpm typecheck` green.

## Resume

Implemented 2026-09-27. `host.ts` has `stopUnwatched(dir)`, the one check that closes a directory's watch when `watchedIn(dir)` is false, called from the last unsubscribe, from a connection's `close` over every changeset its `watching` named, and from both places a session leaves the map. The restart path calls it only when the session is not coming back to the same directory. In `changes.ts` each watcher's `error` listener clears the shared debounce timer, closes its own handle and forgets the ref watch if it was that one.

The new cases failed first: the connection-close and the dispose cases saw `stopped` 0, and `emit('error', ...)` on a fake `FSWatcher` threw the error because nothing listened. All four now pass, and the dispose case also shows a session made again at the same path opening a new watch (`watches` 1 then 2). `changes-refresh.test.ts` has 13 cases green.
