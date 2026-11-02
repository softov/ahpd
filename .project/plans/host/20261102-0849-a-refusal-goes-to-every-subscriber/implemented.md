---
title: A refusal goes to every subscriber, implemented
plan: plan.md
built: 2026-11-02
commits:
  - git://ab12c81b - the plan
  - git://23257a78 - task 01
---

## What changed

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `emit` takes a refusal's reason and its sender.
  It sequences the refusal, holds it for replay and sends it to every other client of the channel, and reduces nothing for it.
  `refuse` sends through it and then tells the sender, under the name `watchedAs` gives it.
  `serverSeq` moves in `emit` and in `echoTo`, the terminal input's answer to its sender alone.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the two passages on a refusal.

## Verified

- Six changed cases fail on 839080c4's sources and pass with the change.
  They are `host-snapshots.test.ts` (a second subscriber and a reconnect), `host-catalogue.test.ts`, `host-input.test.ts`, `host-turn.test.ts`, and two in `changes-review.test.ts`.
- On upstream main 6e6d1ca8 the same six fail on main's `host.ts` and pass with the change.
  The eight changed test files and `host-terminals.test.ts` pass, 281 cases.
- The union's processes run found a seventh: `computer-session.test.ts` held a refused machine change to its sender alone.
  It now expects the refusal at every subscriber; it fails on main's `host.ts` and passes with the change.
- The unit suite on the branch passes, with four files that timed out under load passing alone.
- `pnpm run typecheck` exits 0.

## Against VS Code's host (main 8fb60541)

- The reference host records a rejection and broadcasts it as it does an action (`protocolServerHandler.ts` L766, L4183-L4210).
- Its client keeps a foreign rejection out of its state (`agentSubscription.ts` L386-L403).

## Departures from the plan

- The sender is told in every case, not only where it watches no such channel.
  A client on an older version is withheld actions newer than it, and its own refusal still reaches it.
