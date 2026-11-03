---
title: A row counts frames and bytes
status: todo
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
