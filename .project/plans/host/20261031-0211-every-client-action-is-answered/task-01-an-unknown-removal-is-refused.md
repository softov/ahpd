---
title: An unknown removal is refused
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1393-L1397](../../../../packages/sdk/src/host/chatactions.ts#L1393-L1397) - the removal this task refuses"
  - "[code://packages/sdk/src/host/chatactions.ts#L1403-L1415](../../../../packages/sdk/src/host/chatactions.ts#L1403-L1415) - the refusal to copy"
  - "[code://packages/sdk/src/host/sleep.ts#L104-L108](../../../../packages/sdk/src/host/sleep.ts#L104-L108) - the read of `queuedMessages` to copy"
  - "[code://packages/sdk/test/host-input.test.ts#L469-L480](../../../../packages/sdk/test/host-input.test.ts#L469-L480) - the test beside which the new tests go"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts#L481](../../../../packages/sdk/test/ahp-test-cases.test.ts#L481) - `HOST_REFUSED`"
---

## Objective

The host refuses a `chat/pendingMessageRemoved` when the chat holds no pending message with its id and its effective kind.
A removal that matches goes to `unqueue` as it does today.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:1393-1397` - read `queuedMessages` from `session.chatState()`, and refuse through `no` when no entry matches.
- `UPDATE: packages/sdk/test/host-input.test.ts` - add the tests of an unknown id and of a kind that does not match.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts` - move each removal case that becomes a refusal into `HOST_REFUSED`, with the reason.
- `UPDATE: docs/sdk/AHP.md:287` - say that a removal the chat does not hold is refused.

## Steps

1. In `chat/pendingMessageRemoved`, read the action's id, and its kind with `queued` when it is absent.
2. Read `queuedMessages` from `session.chatState()`, and find the entry with that id and that kind, an absent entry kind being `queued`.
3. When no entry matches, call `no` with a reason that names the id and the kind, and break.
4. When an entry matches, call `unqueue` and `forgetSender` as the case does now.
5. Add a test that removes an id the chat never queued, and expect a `rejectionReason` that names the id.
6. Add a test that removes a queued id with `kind: 'steering'`, and expect a refusal.
7. Keep the test at line 469 passing, so a queued message taken back still never starts its turn.
8. Run `ahp-test-cases.test.ts`, and add each removal case that is now refused to `HOST_REFUSED` under a comment with the reason.
9. Correct the counts in the test that names every case it cannot replay.
10. In `AHP.md` at line 287, add that the host refuses a removal the chat does not hold.

## Validation

- `packages/sdk/test/host-input.test.ts`: the two new tests fail before the change and pass after it.
- `packages/sdk/test/host-senders.test.ts`: a queued message taken back still leaves the sender list empty.
- `packages/sdk/test/ahp-test-cases.test.ts` passes with the moved cases.
- `pnpm typecheck` is clean, and `pnpm --filter @ahpd/sdk test` passes.
- Restore `packages/sdk/test/fixtures/wire.jsonl` after the test run.

## Resume

