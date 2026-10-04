---
title: Session config and root config are files of their own
domain: host
status: built
priority: high
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/48-host-is-split-by-area-p4-telemetry-owners-and-machines/plan.md
refs:
  - "[code://packages/sdk/src/host.ts#L4400-L4637](../../../../packages/sdk/src/host.ts#L4400-L4637) - `SEEDS`, `isolating`, `mergedConfig`, `hostSchema`"
  - "[code://packages/sdk/src/host.ts#L4875-L5110](../../../../packages/sdk/src/host.ts#L4875-L5110) - `propertyOf`, `published`, `sessionSchema`, `runningSchema`, `seeded`, `contributedDefaults`, `droppedSaid`, `storedConfig`, `mineOf`"
  - "[code://packages/sdk/src/host.ts#L4100-L4190](../../../../packages/sdk/src/host.ts#L4100-L4190) - `descriptors`, every backend as the root channel advertises it"
  - "[code://packages/sdk/src/host.ts#L6225-L6396](../../../../packages/sdk/src/host.ts#L6225-L6396) - `rootConfig`, `ROOT_CONFIG_SCHEMA`, `daemonSchema`, `daemonProperties`, `daemonKey`, `restartNeeded`, `advertisedSchemes`, `rootState`"
---

## Goal

What a session may be configured with, and what the root channel says and holds, are two files.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rootConfig` is written by the `root/configChanged` branch of `applyDispatch` and read by `compactPrompts` (p8) and `rootState`; it is a `const` object mutated in place, so the root factory owns it and offers the same object.
- `restartNeeded` is a `let` written once, by the `root/configChanged` branch at `:10147`; it becomes the field `ctx.restartNeeded`.
- Open plans that cite the code this child moves: host/43 p2 (`published`), host/43 p3 (`rootState`'s `config`), host/45 (`rootConfig`, `ROOT_CONFIG_SCHEMA`, `daemonProperties`, `daemonKey`, `rootState`), host/46 (`advertisedSchemes`, root state `_meta`), plugin/33 (`advertisedSchemes`), host/31 (`storedConfig`).

### Gaps

- The `root/configChanged` branch and the two session config methods stay where they are until p9 and p10.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Every factory takes the `HostContext`, and adds its area's fields to `host/context.ts` | the parent's second table, Softov's "One HostContext" | 01, 02 |
| A `let` (`restartNeeded`) becomes a field on the context | Softov, 2026-10-03: "One HostContext", in the parent's second table | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A session's config and schema are one file](task-01-session-config.md) | done | - |
| [02 - Root state and root config are one file](task-02-root.md) | done | 01 |

## Resume state

- **Done so far:** built 2026-10-04, see [implemented.md](implemented.md).

## Final verification checklist

- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass; `test/root-config.test.ts`, `test/session-fixed-key.test.ts`, `test/configvalues.test.ts` and `test/wire.test.ts` cover this area.
- [x] `wc -l packages/sdk/src/host.ts` recorded in `implemented.md`, about 730 lines fewer than before.
- [x] `plans/index.md` updated.
