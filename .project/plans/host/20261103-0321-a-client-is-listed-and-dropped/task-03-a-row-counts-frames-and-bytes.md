---
title: A row counts frames and bytes
status: done
depends:
  - task-02-the-host-lists-and-drops-clients.md
layer: "sdk, server, docs"
refs:
  - "[code://packages/sdk/src/listen.ts#L90-L101](../../../../packages/sdk/src/listen.ts#L90-L101) - `tapping`, which gives each frame its socket number"
  - "[code://packages/server/src/commands/run.ts#L741](../../../../packages/server/src/commands/run.ts#L741) - the daemon's `Tap`, which counts here as well as it captures"
---

## Objective

Each row on `x-ahpd-clients://` holds the frames and bytes in each direction.
A reader sees them change at most once each 5 seconds.

## Files

- `UPDATE: packages/server/src/commands/run.ts:741` - count frames and bytes by socket in the `Tap`, beside the capture.
- `UPDATE: packages/sdk/src/clients/channel.ts` - take a `counters(socket)` option, put the counts on the row, and refresh on a 5-second timer while the channel has a subscriber.
- `UPDATE: docs/plugins/PLUGINS.md` - the four counter fields in the `x-ahpd-clients` section.
- `UPDATE: packages/sdk/test/clients-channel.test.ts` - the counters on the row, and the timer.

## Steps

1. Add a map from socket number to `{ framesIn, framesOut, bytesIn, bytesOut }` in `run.ts`.
2. In the `Tap`, add one frame and the UTF-8 byte length of `text` to the side that `from` names.
3. Remove a socket's entry when the registry says that socket left.
4. Add `counters?(socket: number)` to the `clientsChannel` options.
5. Put the four counts on the row when `counters` answers for that socket.
6. Start a 5-second timer at the first subscriber, and stop it when `subscribers(uri)` is empty.
7. Call `refresh()` on each tick, so the channel sends only the rows whose counts changed.
8. Clear the timer when the daemon stops.
9. Pass `counters` to the channel in `run.ts`.
10. Add the docs fields and the tests named in *Files*.

## Validation

- `packages/sdk/test/clients-channel.test.ts`: a row carries the counts that `counters` answers.
- `packages/sdk/test/clients-channel.test.ts`: with fake timers, a change in the counts reaches a reader after 5 seconds and not before.
- `packages/sdk/test/clients-channel.test.ts`: with no subscriber, no timer runs.
- Run `pnpm typecheck`. Expect no errors.
- Run `pnpm --filter @ahpd/sdk test`, and then `pnpm --filter @ahpd/server test`. Expect a pass from each.

## Resume

Done, with one departure from *Files* recorded below.

The daemon's `Tap` counts as it captures. `traffic` maps a socket number to `ClientCounts`. Each frame adds one to the side `from` names, and its UTF-8 byte length to that side's bytes. The registry watch deletes a socket's entry when its change says it left, and the channel is given the map as `counters`.

`clientsChannel` takes `counters(socket)`, and `rowOf` puts the four counts on the row when it answers. The channel now keeps the handle `servedRecords` binds, so it reads `subscribers('x-ahpd-clients://')`. `snapshot` starts a 5-second interval after the list is answered. Each tick refreshes while a subscriber is there, and stops the timer once none is. `left` stops it at once, and `stop()` clears it when the daemon goes down. In `run.ts`, `way.down` calls `clients.stop()`. `docs/plugins/PLUGINS.md` gains the four fields and the cadence.

Validation passed. A row carries the counts `counters` answers, and the test with fake timers sees no `changed` action at 4,999 ms and one at 5,000 ms. A spy shows no `setInterval` before a subscriber and one after, cleared by the unsubscribe. `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass. `pnpm --filter @ahpd/sdk test` passes 4069 with 2 skipped. `pnpm --filter @ahpd/server test` passes 1756 with 2 skipped. Its first run timed out on `plugin-load.test.ts`'s bot row at 5 seconds under load; the whole suite passed on the re-run.

**Departures:** `ClientCounts` is declared and exported in `clients/channel.ts`, and `packages/sdk/src/index.ts` exports it for the daemon's map, which task 02 had already updated. The timer starts in `snapshot` rather than after reading a subscriber there, because the host records the subscription after the snapshot returns. The subscriber list is empty at that moment, so the first tick is where it is read.
