---
title: The goal carries a queued message taken up while idle
status: done
depends: []
layer: "sdk test"
refs:
  - "[code://packages/sdk/test/ahp-test-cases.test.ts#L612-L673](../../../../packages/sdk/test/ahp-test-cases.test.ts#L612-L673) - the driver"
---

## Objective

The goal a watching client is held to is the reducer over the accepted actions and the consumption the protocol has the host say.
The four queued cases then exempt the host's activity alone.

## Files

- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:427` - `CONSUMED` goes, its rule cited where the driver builds the goal.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:442-445` - the four entries exempt `activity`, under THINKING.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:577-582` - `Driven.reduced` says it carries what the host says on its own.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:656-667` - the watched actions are kept, and the goal walks the accepted actions with the consumption.

## Steps

1. Keep the watched actions as `told`, and reduce the view from them.
2. Walk the accepted actions; after a queued message on an idle chat, add its removal and the turn naming it.
3. Read the turn's id and start off the host's turn with that `queuedMessageId`.
4. Use the case's `expected` only when the host refused nothing and the walk added nothing.
5. Narrow the four entries to `activity`, and drop `CONSUMED`.
6. Make the host's queued turn carry another message, and run the old and the new cases against it.

## Validation

- The whole file passes on the host as it stands.
- With the host's queued turn carrying another message, the new cases fail 045, 046, 047 and 052.
- Main's cases pass all 647 against that host.

## Resume

Done 2026-11-02 in `594c2fd5`; [implemented.md](implemented.md) says what was verified.
