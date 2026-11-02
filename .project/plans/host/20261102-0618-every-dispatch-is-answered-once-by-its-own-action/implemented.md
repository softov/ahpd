---
title: Every dispatch is answered once, by its own action, implemented
plan: plan.md
built: 2026-11-02
commits:
  - git://f920fd46 - the plan
  - git://0544d5e9 - the answers a turn owes are given at its end
  - git://3295a51f - a dispatch answered is not refused after
  - git://dcfdb2d0 - an automation request is answered by itself, and a removal of nothing by itself
---

## What changed

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - a turn's end says what it still owes.
  An owed start goes out ahead of the end, and an owed stop or client result after it, each under its client's origin.
  An end is the backend's or the host's, or a client's stop of the turn the chat holds running.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `said` holds each origin an answer carried.
  `refuseFailed` logs a failure past an answer and refuses only a dispatch nothing answered.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - a create or an update the store took goes out as the client's request after `automation/set`.
  A removal of an automation the store does not hold goes out as the client's removal.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the rows for the two requests, `automation/set` and `automation/removed`.

## Verified

- `echo-origin.test.ts`: a backend that never says a stop has its turn complete first, and the client's stop comes back after the end.
  On e4694965 no envelope answers it.
- `echo-origin.test.ts`: a backend that says a draft and then throws gives one answer, the echo.
  On e4694965 the client also got a rejection.
- `automations.test.ts`: a create, an update and a removal of nothing each come back with the client's origin, the create after its `automation/set`.
  On e4694965 none of the three is answered.
- The turn suites and the claude, cofold and pi packages pass, 2008 tests.
- Every sdk test that throws in a dispatch passes, 1227, and every test that sends an automation request, 197.
- `pnpm run typecheck` exits 0.

## Not done here

- Correction 3's other labels are in the ledger's section "Corrections 3 and 4, as built", each with its finding and next step.
