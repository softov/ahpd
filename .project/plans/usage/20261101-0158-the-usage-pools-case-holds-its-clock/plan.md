---
title: The usage pools case holds its clock
domain: usage
status: built
priority: medium
created: 2026-11-01
revalidated: 2026-11-01
refs:
  - "[code://packages/sdk/test/users-gate-commands.test.ts#L473-L521](../../../../packages/sdk/test/users-gate-commands.test.ts#L473-L521) - the case: two records dated 2026-10-02, then a read of `usage://team%3Abackend/month` that expects both calls"
  - "[code://packages/sdk/src/usage/usage.ts#L867-L875](../../../../packages/sdk/src/usage/usage.ts#L867-L875) - `periods` cuts the month from `new Date()`, the clock the case reads"
  - "[code://packages/sdk/test/usage-scheme.test.ts#L27-L39](../../../../packages/sdk/test/usage-scheme.test.ts#L27-L39) - the pattern: a `NOW` in the month the records are dated in, `Date` alone faked and set to it, real timers back after"
  - "[code://packages/sdk/test/host-catalogue.test.ts#L1257-L1258](../../../../packages/sdk/test/host-catalogue.test.ts#L1257-L1258) - the same two calls inside one case of a host suite"
---

## Goal

The users gate suite's usage pools case passes on any day.
The case reads the month of its records, so it holds the clock inside that month.
The usage scheme suite holds its own clock the same way.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "setSystemTime|useFakeTimers" packages/sdk/test` - `usage-scheme.test.ts` pins `Date` for every case, `host-catalogue.test.ts` pins it inside one case of a host suite.
- `rg -n "/month" packages/sdk/test` - `usage-scheme.test.ts` reads a month under its pinned clock; `users-gate-commands.test.ts` reads one under the wall clock.

### Runtime path

```
resourceRead usage://team%3Abackend/month -> usageProvider read -> periods(pool) -> spansOf(new Date()) -> usage.total(pool, month start, now)
```

### Gaps

- The case records two calls at 2026-10-02T10:00:00.000Z and reads the month leaf, which `spansOf` cuts from the wall clock.
- From 2026-11-01T00:00Z the month is November, the read returns `{}`, and the case fails on `main` 47d14247.
- The rest of the case names pools, not periods, and does not depend on the date.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The case holds `Date` at 2026-10-07T12:00:00.000Z, inside the month its records are dated in, and lets go of it when it ends | [code://packages/sdk/test/usage-scheme.test.ts#L27-L39](../../../../packages/sdk/test/usage-scheme.test.ts#L27-L39) | 01 |
| Only `Date` is faked, so the host's timers keep running | [code://packages/sdk/test/host-catalogue.test.ts#L1257](../../../../packages/sdk/test/host-catalogue.test.ts#L1257) | 01 |

## Proposed architecture

- **Layer responsibilities** - sdk tests: the one case changes; no source file changes.
- **Source-of-truth files** - [`code://packages/sdk/test/users-gate-commands.test.ts`](../../../../packages/sdk/test/users-gate-commands.test.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the case holds its clock](task-01-the-case-holds-its-clock.md) | done | - |

## Risks and tradeoffs

- A faked clock inside a host case could stall a timer the host waits on - only `Date` is faked, as in `host-catalogue.test.ts`.

## Resume state

- **Done so far:** task 01, 2026-11-01.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** the clock is let go in a `finally`, so a failing assertion does not leave it faked for the cases after it.

## Final verification checklist

- [x] `pnpm exec vitest run packages/sdk/test/users-gate-commands.test.ts` passes on 2026-11-01, where the case failed before the change.
- [x] Every other case in the file passes as before.
