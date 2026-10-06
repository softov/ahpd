---
title: An unreadable computers file is not overwritten
status: done
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

Implemented. `read` answers `Record<string, Entry> | undefined`: `{}` for a file that is not there, which is every host that has not written one yet, and `undefined` for one that is there and could not be read, parsed, or has something other than an object at the top - each of those already said a line. The four readers that only ask take the two alike, `?.` or `?? {}`, since a machine whose record cannot be read is charged to the host rather than to a guess.

The five that write read through `writable`, which answers the records or, on `undefined`, logs `not writing <path>: it is there and could not be read, so the records it holds would go with the write` and answers nothing. Each caller returns on that: `claimOwned`, `claimAdopted`, `keepProbe`, `keepMadeNeeds` and `forgetOwned`. Said in one place because the rule is one rule - a write is the whole file - and a caller that forgot it would drop every machine the file names.

The case failed first with the file holding the third id alone, which is the defect exactly: `keepProbe` on a `computers.json` with two owners and a trailing comma replaced both with `{ three: { probe } }`. It passes now with the file byte for byte what it was, the line naming the path, and `ownedOf` answering nothing for a machine the file still names.

Gates: `npx tsc -b` clean, `pnpm exec vitest run packages/computer/test/computer-owner.test.ts` 6 passed.
