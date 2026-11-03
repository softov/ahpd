---
title: pi and ACP turns read back the same way
status: done
depends: []
layer: "agent-pi, agent-acp"
refs:
  - "[code://packages/agent-pi/src/replay.ts](../../../../packages/agent-pi/src/replay.ts) - `replayEntries`, which rebuilds pi's turns from its file"
  - "[code://packages/agent-acp/src/transcript.ts](../../../../packages/agent-acp/src/transcript.ts) - `replayedTurns` and `turnsOf`"
---

## Objective

A pi or ACP call the record never ends reads back cancelled as skipped, and the turn holding it cancelled.
A pi turn reads back what every answer in it used, summed as its live turn says it.

## Files

- `UPDATE: packages/agent-pi/src/replay.ts:95-117` - each unfinished call cancelled with its turn, and the usage summed.
- `UPDATE: packages/agent-acp/src/transcript.ts:48-132` - a replayed turn with a call that never ends is cancelled, and each open call cancelled.
- `UPDATE: packages/agent-pi/test/agent-pi-disk.test.ts` - a turn of two answers, a call with no result, and the rebuilt session's usage.
- `UPDATE: packages/agent-acp/test/agent-acp-catalog.test.ts` - a replayed call with no end.

## Steps

1. Sum each answer's usage in a pi turn with `addUsage`, the function the live turn sums with.
2. Read a pi call with no end back cancelled as skipped, and its turn cancelled.
3. Read an ACP replayed turn whose call never ends back cancelled.
4. Cancel each ACP call still open when its turn ended, as the reducer does.

## Validation

- Before the change, a pi turn of two answers reads back one answer's usage.
- Before the change, a pi call with no end reads back running.
- Before the change, an ACP replayed turn with a call that never ends reads back complete.
- The pi and ACP suites pass.

## Resume

Done. Before the change the pi turn read back one answer's usage and a running call, and the ACP turn read back complete.
The pi and ACP suites pass.
