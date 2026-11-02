---
title: A state read back reaches its clients whole - implemented
date: 2026-11-01
refs:
  - git://31c21c88
  - "[code://packages/sdk/src/host/handshake.ts](../../../../packages/sdk/src/host/handshake.ts)"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts)"
  - "[code://packages/agent-claude/src/transcript.ts](../../../../packages/agent-claude/src/transcript.ts)"
---

A state the host reads back from a record is the state each of its clients holds.
A client served a state the host has let go of since is answered with the state read again when it comes back.
A command's turn is kept as its chat's state holds it.
A Claude, pi or ACP turn read back ends the way the reference reads a Claude transcript back.

## What was built

- [`code://packages/sdk/src/host/state.ts`](../../../../packages/sdk/src/host/state.ts) - `HeldState.baselines`, the clients a state was served to.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - a state let go adds its channel to each of those clients' `lapsed` set.
- [`code://packages/sdk/src/host/routing.ts`](../../../../packages/sdk/src/host/routing.ts) - `answeredAs` records the client a snapshot goes to, and takes the channel out of its `lapsed` set.
- [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts) - a reconnect resuming a lapsed channel is answered with snapshots.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - a command's turn is kept from the chat's held state.
- [`code://packages/agent-claude/src/transcript.ts`](../../../../packages/agent-claude/src/transcript.ts) - a call with no result reads back cancelled as skipped, and its turn cancelled.
- [`code://packages/sdk/src/host/history.ts`](../../../../packages/sdk/src/host/history.ts) - a worker read back is linked from its call only where the call finished, since a cancelled call carries no content.
- [`code://packages/agent-pi/src/replay.ts`](../../../../packages/agent-pi/src/replay.ts) - the same for pi, and a turn's usage summed with `addUsage`.
- [`code://packages/agent-acp/src/transcript.ts`](../../../../packages/agent-acp/src/transcript.ts) - the same for an ACP replay, and a call open at its turn's end cancelled as skipped.
- [`AHP.md`](../../../../docs/sdk/AHP.md), [`AGENT.md`](../../../../docs/sdk/AGENT.md) and [`TERMINALS.md`](../../../../docs/sdk/TERMINALS.md) - the reconnect, the read-back a backend answers, and the kept turn.

## Each audit row

| Row | Backend | What it is now |
| --- | --- | --- |
| CS20 | Claude | Built: a call with no result reads back cancelled as skipped, and its turn cancelled |
| P8 | pi | Built: the usage is every answer's summed, and a call with no result reads back as Claude's does |
| P8 | pi | Needs nothing for the origin, the calls' `not-needed` and the message's text: the reference reads a Claude turn back the same |
| Q24 | ACP | Built: a replayed turn with a call that never ends reads back cancelled, the call cancelled as skipped |
| B10 | bot | Needs nothing: a turn's begun line holds no call, and the reference reads a turn with no open call back complete |

## Verified

- `session-sleep.test.ts`: a client back from a drop after its session slept was answered with a replay before the change, and with snapshots after.
- `host-local-turns.test.ts`: a command's turn its backend recorded `error` was kept `error` before, and as its clients hold it after.
- `agent-claude-transcript.test.ts`, `agent-pi-disk.test.ts` and `agent-acp-catalog.test.ts`: each read-back case failed before its change.
- `host-snapshots.test.ts`: a worker's call that never finished read back cancelled with a link in content no cancelled call declares, before the guard.
- `pnpm run typecheck` and `pnpm run boundary` exit 0, on the branch rebased onto R1's adf4ca5e.
- The oracle passes 647 of 647 on that base.
- `pnpm run test:unit --maxWorkers=2`: 7368 passed, 14 failed, 28 skipped, every failure but one a timeout.
- Run again one file at a time, nine of the twelve files passed.
- The usage pools case fails on R1 as well, and the union carries its fix from another branch.
- The usage and vault port cases now have the 20 s the package's other daemon cases have, and pass three runs of three.
- `plugin-load.test.ts`'s bot case passes alone in 0.3 s.
- In the whole file it failed one run of three on the branch, and three of three on R1 under the same load.
- `pnpm run test:processes --maxWorkers=2`: 617 passed, 78 failed, 30 skipped, in 17 files, timeouts but one cascade.
- Run again one file at a time, 15 files passed; the other two passed twice more on the branch.
- R1 failed one of those two files once in two runs under the same load.

## Departures from the plan

- The worker link's guard in `history.ts`, which the plan did not name: the Claude read-back made a cancelled worker call reachable.

## Left for later

- Nothing; every task is done.
