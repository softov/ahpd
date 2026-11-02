---
title: A client's call content is held - implemented
date: 2026-11-02
refs:
  - git://c72061cd
  - "[code://docs/sdk/AHP.md](../../../../docs/sdk/AHP.md)"
---

The row, the case's comment and the test say what the host does with a client's call content.

## What was built

- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the row says the content goes to every client of the chat and the held state folds it.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - the case's comment says the same.
- [`code://packages/sdk/test/host-tools.test.ts`](../../../../packages/sdk/test/host-tools.test.ts) - the action carries its `turnId`, and a later subscriber is served the content.

## Verified

- A later subscriber is served the call with `[{ type: 'text', text: 'reading…' }]`.
- Without `turnId` the reducer finds no call, and the later subscriber is served the call with no content.
- `host-tools.test.ts` passes, 80 tests.
- `rg -n "holds none of it|rather than reduced" docs packages` finds nothing about a call's content.

## Departures from the plan

- none.

## Left for later

- none.
