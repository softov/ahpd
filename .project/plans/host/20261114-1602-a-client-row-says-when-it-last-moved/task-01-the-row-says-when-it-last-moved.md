---
title: The row says when it last moved
status: todo
depends: []
layer: "server, sdk host, sdk clients, docs"
refs:
  - "[code://packages/server/src/commands/run.ts#L846-L860](../../../../packages/server/src/commands/run.ts#L846-L860) - the tap, which gains the times"
  - "[code://packages/sdk/src/clients/channel.ts#L50-L59](../../../../packages/sdk/src/clients/channel.ts#L50-L59) - `ClientCounts`, which gains `lastIn` and `lastOut`"
  - "[code://packages/sdk/src/host/handshake.ts#L560](../../../../packages/sdk/src/host/handshake.ts#L560) - `ping`, which stamps `lastPing`"
  - "[code://packages/sdk/src/host/handshake.ts#L328-L351](../../../../packages/sdk/src/host/handshake.ts#L328-L351) - `initialize`, which sets `arrival`"
  - "[code://packages/sdk/src/host/handshake.ts#L574-L637](../../../../packages/sdk/src/host/handshake.ts#L574-L637) - `reconnect`, which sets `arrival`"
  - "[code://packages/sdk/src/host.ts#L2422](../../../../packages/sdk/src/host.ts#L2422) - the connection's `handle`, which counts a throw"
---

## Objective

A row says when a frame last crossed each way and when the client last pinged.
It also says how the socket came in, and how many of its requests the host refused.

## Files

- `UPDATE: packages/sdk/src/clients/channel.ts:50-59` - add `lastIn` and `lastOut` to `ClientCounts`, each optional, and export `countFrame`, which adds one frame to a count.
- `UPDATE: packages/server/src/commands/run.ts:846-860` - the tap calls `countFrame` in place of its own sums.
- `UPDATE: packages/sdk/src/types/host.ts:2015-2117` - add `lastPing`, `arrival` and `refused` to `Connection`.
- `UPDATE: packages/sdk/src/types/host.ts:179-200` - add `lastPing`, `arrival` and `refused` to `ConnectedClient`.
- `UPDATE: packages/sdk/src/host/handshake.ts:560` - `ping` sets `connection.lastPing`.
- `UPDATE: packages/sdk/src/host/handshake.ts:328-351` - `initialize` sets `connection.arrival` to `initialize`.
- `UPDATE: packages/sdk/src/host/handshake.ts:574-637` - `reconnect` sets `connection.arrival` to `reconnect`.
- `UPDATE: packages/sdk/src/host.ts:2422` - `handle` adds one to `connection.refused` when the request throws, then throws again.
- `UPDATE: packages/sdk/src/host.ts:1973-1984` - `clientRow` copies `lastPing`, `arrival` and `refused`.
- `UPDATE: packages/sdk/test/clients-channel.test.ts` - a counter with `lastIn` and `lastOut` reaches the row.
- `UPDATE: packages/sdk/test/host-handshake.test.ts` - cases for `lastPing`, `arrival` and `refused`.
- `UPDATE: docs/plugins/PLUGINS.md:1878` - name the five fields beside the counters.

## Steps

1. Add `lastIn` and `lastOut` to `ClientCounts`, documented as wall-clock milliseconds.
2. Write `countFrame(counts, from, bytes, now)` in `clients/channel.ts`, which adds the frame and its bytes and stamps `lastIn` or `lastOut`.
3. Make the tap in `run.ts` call `countFrame` with `Date.now()`.
4. Add `lastPing`, `arrival` and `refused` to `Connection` and to `ConnectedClient`.
5. In `ping`, set `connection.lastPing` to `Date.now()` before the answer.
6. In `initialize`, set `connection.arrival` to `'initialize'` beside `connection.protocolVersion`.
7. In `reconnect`, set `connection.arrival` to `'reconnect'` beside `connection.protocolVersion`.
8. Wrap the body of `handle` in a `try`, and add one to `connection.refused` in its `catch` before it throws again.
9. In `clientRow`, copy `lastPing` and `arrival` when set, and `refused` when it is above zero.
10. Write the tests that *Validation* lists.
11. Update the `x-ahpd-clients` section of `PLUGINS.md`.

## Validation

- `packages/sdk/test/clients-channel.test.ts`: a `counters` answer with `lastIn` and `lastOut` puts both on the row.
- `packages/sdk/test/host-handshake.test.ts`: a row after `ping` carries `lastPing`.
- `packages/sdk/test/host-handshake.test.ts`: a row after `initialize` carries `arrival: 'initialize'`, and after `reconnect` carries `arrival: 'reconnect'`.
- `packages/sdk/test/host-handshake.test.ts`: two requests for an unknown method give `refused: 2`.
- `packages/sdk/test/clients-channel.test.ts`: `countFrame` for a client frame adds to `framesIn` and `bytesIn`, and sets `lastIn`.
- `packages/sdk/test/clients-channel.test.ts`: `countFrame` for a host frame adds to `framesOut` and `bytesOut`, and sets `lastOut`.
- `pnpm --filter @ahpd/sdk test` and `pnpm --filter @ahpd/server test` pass.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- By hand on a test daemon: ahpw's row shows `lastIn` and `lastOut` moving within 5 seconds.

## Resume
