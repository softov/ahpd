---
title: The oracle holds a refusal to its condition
status: todo
depends: [01]
layer: "sdk tests"
refs:
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts) - `REFUSALS` and the check of each refusal"
---

## Objective

Each refusal row the protocol states over the chat's state carries that condition, and the oracle reads it against the state the client held.
A refusal whose condition that state contradicts fails its case.

## Files

- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:482-551` - `holds` on each stated row, and the rows a held-state check refuses with.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:695-705` - the check reduces the client's accepted actions and reads `holds` at each refusal.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:376-425` - the entries for 015 and 224 go.

## Steps

1. Give each stated row of `REFUSALS` a `holds` predicate over a chat state.
2. Add the rows for a resume during a turn and for a turn the backend cannot rerun.
3. Add the row for a turn the backend cannot rewind to.
4. Add the reference's row for a steering message a turn already holds.
5. Reduce the client's accepted actions from its start, and read the matching row's `holds` at each refusal.
6. Run the file against the host before task 01, and record each case it fails.
7. Remove the entries for 015 and 224, and run the file after task 01.

## Validation

- Against the host before task 01, the file fails 15 cases.
- Each fails on a refusal against a state that says otherwise, or on a client nobody answered.
- After task 01, `pnpm exec vitest run packages/sdk/test/ahp-test-cases.test.ts` passes 647 of 647.

## Resume

<Empty until started.>
