---
title: A usage total says the tokens sent and the tokens received, beside the sum
domain: usage
status: planned
priority: high
created: 2026-10-07
revalidated: 2026-10-07
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/types/usage.ts#L59-L71](../../../../packages/sdk/src/types/usage.ts#L59-L71) - `ModelCall`, which already keeps `input`, `output` and `cache`"
  - "[code://packages/sdk/src/types/usage.ts#L90-L108](../../../../packages/sdk/src/types/usage.ts#L90-L108) - `UsageTotal`, which has one `tokens`"
  - "[code://packages/sdk/src/usage.ts#L22-L30](../../../../packages/sdk/src/usage.ts#L22-L30) - `Measured`, the per-day sum"
  - "[code://packages/sdk/src/usage.ts#L115-L135](../../../../packages/sdk/src/usage.ts#L115-L135) - `measured`, which adds the four counts into one"
  - "[code://packages/sdk/src/usage.ts#L255-L273](../../../../packages/sdk/src/usage.ts#L255-L273) - the total over a range"
  - "[code://packages/sdk/test/usage.test.ts#L55](../../../../packages/sdk/test/usage.test.ts#L55) - the test that charges one model call"
  - "file:///github/ahpapp/.project/plans/usage/02-a-pool-shows-tokens-sent-and-received/plan.md - the ahpapp plan that draws the split"
---

## Goal

A pool's day, week and month say the tokens sent, received and cached.
The sum they have today stays.

## Reconnaissance

### Searches performed

- 2026-10-07: every model record carries `input`, `output` and `cache`. `measured` adds the four into `tokens`, so the totals lose the split.
- `tokens` is read by the policy limits (`docs/POLICY.md`) and by ahpapp. It stays as it is.

### Runtime path

```
ModelUse { input, output, cache } -> measured -> per-day Measured -> total over a range -> UsageTotal -> usage scheme -> client
```

### Gaps

- `Not found: a sent or received count in a total - searched "tokens" in packages/sdk/src/usage.ts`.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| - | none | - |

| What | Source | Task |
| --- | --- | --- |
| A total shows tokens sent and received | Softov, 2026-10-07, asked "Show tokens sent and received separately?" and answered "plan and starting fixing this" | 01 |
| `UsageTotal` gains `input`, `output` and `cache`; `tokens` stays the sum of all three | (defaulted: the policy limits and clients read `tokens` today) | 01 |
| `cache` is reads plus writes | (defaulted: `tokens` already counts both) | 01 |
| A measure that is zero is absent, as every other measure is | (defaulted: the rule the total already follows) | 01 |

## Proposed architecture

- **State flow** - `Measured` keeps `input`, `output` and `cache` beside `tokens`, and the range total adds them the same way.
- **Source-of-truth files** - [`code://packages/sdk/src/usage.ts`](../../../../packages/sdk/src/usage.ts) and [`code://packages/sdk/src/types/usage.ts`](../../../../packages/sdk/src/types/usage.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A total carries the three counts](task-01-a-total-carries-the-three-counts.md) | todo | - |

## Risks and tradeoffs

- None known. The new fields are optional, so a client that does not read them is unchanged.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-total-carries-the-three-counts.md](task-01-a-total-carries-the-three-counts.md).
- **Open questions:** none.
- **Watch out for:** the strict schema; run `node tools/schema.mjs` after the type changes.

## Final verification checklist

- [ ] A test: one model call gives a total with `input`, `output`, `cache` and their sum in `tokens`.
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass.
- [ ] `plans/index.md` updated.
