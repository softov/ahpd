---
title: An unreadable computers file is not overwritten
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/owners.ts#L124-L153](../../../../packages/computer/src/owners.ts#L124-L153) - `read` answers `{}` for a file it could not read or parse"
  - "[code://packages/computer/src/owners.ts#L164-L178](../../../../packages/computer/src/owners.ts#L164-L178) - `write`"
  - "[code://packages/computer/src/owners.ts#L256-L262](../../../../packages/computer/src/owners.ts#L256-L262) - `keepProbe`, one of the read-then-write callers"
  - "[code://packages/computer/test/computer-owner.test.ts](../../../../packages/computer/test/computer-owner.test.ts) - its cases"
---

## Objective

When `computers.json` exists and cannot be read or parsed, no write replaces it: the write is refused and logged with the file's path, and the readers still answer nothing for it.

## Files

- `UPDATE: packages/computer/src/owners.ts:124-153` - `read` tells a missing file (no entries) from one it could not read; today both answer `{}`.
- `UPDATE: packages/computer/src/owners.ts:164-178` and the read-then-write callers (`claimOwned`, `claimAdopted`, `keepProbe`, `keepMadeNeeds`, `forgetOwned`) - a write after a failed read is not made; today `keepProbe` on a file with one bad byte writes `{ [id]: { probe } }` and every other machine's owner, team and project is gone.
- `UPDATE: packages/computer/test/computer-owner.test.ts` - the case below.

## Steps

1. Failing case first: write `computers.json` holding two owners and a trailing `,`, then `keepProbe` for a third id. Today the file afterwards holds the third id alone; after, it is byte for byte what it was and the log names it.

## Validation

- The case fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/computer/test/computer-owner.test.ts`.

## Resume
