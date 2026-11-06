---
title: A minute limit counts each person
domain: usage
status: built
priority: high
created: 2026-11-04
revalidated: 2026-11-04
refs:
  - git://0538977c - the commit of ahpd the facts were checked at, and the last that holds `problems/a-minute-limit-for-each-person-is-never-enforced.md`, which this plan replaces
  - "[code://packages/sdk/src/usage/charge.ts#L136-L140](../../../../packages/sdk/src/usage/charge.ts#L136-L140) - `keyOf` ends the key of an `each` row in `/user:<id>`"
  - "[code://packages/sdk/src/usage/charge.ts#L409-L418](../../../../packages/sdk/src/usage/charge.ts#L409-L418) - `countCall` counts only a key that ends in the measure"
  - "[code://packages/sdk/src/usage/usage.ts#L43-L48](../../../../packages/sdk/src/usage/usage.ts#L43-L48) - `meterKey` reads only the last segment of the key"
  - "[code://packages/sdk/src/access/policies.ts#L108-L126](../../../../packages/sdk/src/access/policies.ts#L108-L126) - `limitOf` accepts a minute period with any pool"
---

## Goal

A limit with `period: minute` and `pool: each` refuses a person's calls past the amount in one minute.
Today the meter never adds to such a key, so the operator gets no limit and is not told.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "endsWith\(|lastIndexOf\('/'\)" packages/sdk/src/usage` - `countCall` and `meterKey` are the two readers of a key's measure.

### Runtime path

```
call allowed -> countCall(keys) -> MinuteMeter.add -> limit check -> meterKey -> meter sum
```

### Gaps

- `countCall` and `meterKey` read the measure from the end of the key, and an `each` key ends in `user:<id>`.
- No test covers a minute limit with `pool: each`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Fix the seven open problems of the review now | Softov, 2026-11-04, "7 open problems, fix now" | 01 |
| A minute limit with `pool: each` counts, and is not refused at load | Softov, 2026-11-04, chose "Make it count" | 01 |
| One function reads a key's measure, the segment before `/user:` or else the last one, and `countCall` and `meterKey` both use it | (defaulted: two readers of one key shape share one reader) | 01 |

## Proposed architecture

- **Layer responsibilities** - sdk: `measureOf(key)` beside `keyOf` in `charge.ts`, used by `countCall` and by `meterKey` in `usage.ts`.
- **Source-of-truth files** - [`code://packages/sdk/src/usage/charge.ts`](../../../../packages/sdk/src/usage/charge.ts), [`code://packages/sdk/src/usage/usage.ts`](../../../../packages/sdk/src/usage/usage.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - each person's key is counted](task-01-each-persons-key-is-counted.md) | done | - |

## Risks and tradeoffs

- An operator who set such a limit gets it enforced after the update, with no notice. That is the limit they wrote.

## Resume state

- **Done so far:** task 01 is implemented on 2026-11-04.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** `memberPrefixOf` builds the same `/user:` shape; keep it in step with `measureOf`.

## Final verification checklist

- [x] `pnpm --filter @ahpd/sdk test` passes, run alone.
- [x] `pnpm typecheck` and `pnpm boundary` pass.
