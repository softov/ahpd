---
title: The protocol's cases are the oracle - implemented
date: 2026-11-01
refs:
  - git://a2d286cb
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts)"
  - "[code://packages/sdk/test/conformance.test.ts](../../../../packages/sdk/test/conformance.test.ts)"
---

Every root, session and chat case of the protocol now runs through the host the way a client sends it.
A client that only watched is held to the protocol reducer over what the host accepted.
A client that subscribes afterwards is held to what that watcher holds.
Every refusal is held to its words and its source, and every negotiation row goes through the host.
Each place the host answers otherwise is named, with the rule it breaks.

## What was built

- [`code://packages/sdk/test/ahp-test-cases.test.ts`](../../../../packages/sdk/test/ahp-test-cases.test.ts) - `canonical`, the one comparison; the negotiation rows through the host; `driven` with a watching client and a later one; `DIVERGES`, `ALLOWED` and `REFUSALS`.
- [`code://packages/sdk/test/conformance.test.ts`](../../../../packages/sdk/test/conformance.test.ts) - numbered dispatches, `started` for a declared turn, the config case on `permissionMode`, and `held` leaving refusals out.
- [`code://packages/sdk/test/notes.test.ts`](../../../../packages/sdk/test/notes.test.ts) and [`code://packages/sdk/test/operations.test.ts`](../../../../packages/sdk/test/operations.test.ts) - folds that leave refusals out.

## Verified

- `ahp-test-cases.test.ts` passes 647 of 647, three runs in a row, with the same divergences each time.
- The same file run against the host at 5da31824, before the group 9 correction, fails two cases.
- There, case 272's watching client misses the default chat's archived bit, and case 073 lacks the session archive's effect on the default chat.
- So the checks fail on the defect the group 9 correction fixed, and pass after it.
- The conformance, notes and operations suites pass 50 of 50; `pnpm run typecheck` exits 0.
- The full round at two workers, on a loaded machine, failed 2 unit tests and 7 process tests.
- One unit failure is the usage pools case, which reads the current month over October records; its own branch fixes it.
- Every other failing file passed when run alone: `nested-start`, and `computer-libvirt`, `computer-parts-build`, `server-cli-doctor`, `server-cli-service`, `server-cli` at load 2.

## Departures from the plan

- Answer 2 - check 2 also lists the host's own actions that the protocol has it send, each with its sentence, in `ALLOWED`. A turn's activity and a queued message consumed while idle are not in the case's actions, so the reducer over those alone cannot hold them.
- Task 02 - the clock stands still within each step of a case and moves a minute between steps. A stamp the host takes in a later step then differs on every run. Two stamps taken in one step are equal under it; see [deferred.md](deferred.md).
- Task 04 - the package's own negotiation rule is no longer asserted beside the host's answer; the host's answer is what the rows check.

## Left for later

- Starting a case from its `initial`, and the other waits - see [deferred.md](deferred.md).
