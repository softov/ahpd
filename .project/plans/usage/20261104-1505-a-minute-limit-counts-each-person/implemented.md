---
title: A minute limit counts each person - implemented
date: 2026-11-05
refs:
  - git://a8807a2b - the merge of #226
  - "[code://packages/sdk/src/usage/charge.ts](../../../../packages/sdk/src/usage/charge.ts) - `measureOf`, which counts a key of `pool: each` per person"
---

A limit with `period: minute` and `pool: each` now counts each person's calls, and refuses a person's calls past the amount in one minute.

## What was built

- [`code://packages/sdk/src/usage/charge.ts`](../../../../packages/sdk/src/usage/charge.ts) - `measureOf`, read for a key of each person.
- [`code://packages/sdk/src/usage/usage.ts`](../../../../packages/sdk/src/usage/usage.ts) - the meter adds to that key.

## Verified

- The new cases in `charge.test.ts` and `usage.test.ts` fail without the change.
- CI on main after #242 passed every check.

## Departures from the plan

- `measureOf` is in `charge.ts`, because `usage.ts` imports `charge.ts`.

## Left for later

- none
