---
title: Only copied attachments are removed from a machine - implemented
date: 2026-11-12
refs:
  - git://239e83ede
  - "[code://packages/sdk/src/host/machines.ts](../../../../packages/sdk/src/host/machines.ts) - the copied paths, `takeOut` and `leavesWith`"
  - "[code://packages/sdk/src/host/lifecycle.ts](../../../../packages/sdk/src/host/lifecycle.ts) - teardown asks before it takes anything out"
  - "[code://packages/sdk/test/host-machine-attachments.test.ts](../../../../packages/sdk/test/host-machine-attachments.test.ts) - the three cases"
---

A session's removal takes out of its machine only the attachment paths it copied in.
A disposable machine that goes with its last session gets no removal at all.
A session that sent no attachment makes no `rm` in any machine.

## What was built

- [`code://packages/sdk/src/host/machines.ts`](../../../../packages/sdk/src/host/machines.ts) - `copied`, the paths `putIn` copied for each session, which `takeOut` sends and deletes.
- [`code://packages/sdk/src/host/machines.ts`](../../../../packages/sdk/src/host/machines.ts) - `disposables`, the machines the host made from a `disposable:` source, and `leavesWith`, which answers whether the machine goes with this session.
- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - teardown calls `takeOut` only when `leavesWith` says the machine stays.
- [`code://packages/sdk/test/host-machine-attachments.test.ts`](../../../../packages/sdk/test/host-machine-attachments.test.ts) - the kept-machine case takes out only the copied path. A session that copied nothing takes nothing out. A disposable machine's last session takes nothing out.

## Verified

- `pnpm exec tsc -p tsconfig.json --noEmit` at the root passes.
- The sdk suite at review, 2026-11-12: 4762 passed, 5 skipped.
- At review, `leavesWith` also drops the session's record of copied paths, since `takeOut` is not asked for a machine that goes with the session.

## Departures from the plan

- The *Watch out for* says the check reads the machine's disposable label and its session set. The `ComputerPort` has no question that reads the label. The plan keeps the work in the sdk, so `machines.ts` records each machine it makes from a `disposable:` source. Teardown reads the session set from `enteredIn`.
- `takeOut` no longer reads the session's attachments folder from the store, so the `idOf` import and the `kept` binding leave `machines.ts`.
- The answer also reached `packages/computer/test/computer-attachments.test.ts`, whose case asserted the old folder removal. That case now proves the disposable machine goes with no `rm -rf`. A second case proves a machine that stays removes only the copied paths.

## Left for later

- The record of a disposable machine is in memory, as the plan's risks say of the copied paths. A restart forgets both, and a restarting host has no copied path to send anyway.
