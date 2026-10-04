---
title: Telemetry, sign-in requirements, owners and machines are files of their own
domain: host
status: built
priority: high
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/48-host-is-split-by-area-p2-routing/plan.md
refs:
  - "[code://packages/sdk/src/host.ts#L1305-L1432](../../../../packages/sdk/src/host.ts#L1305-L1432) - `LOGS`, `TRACES`, `METRICS`, `telling`, `hex`, `attributed`, `startedAt`, `fire`, `logging`, `log`"
  - "[code://packages/sdk/src/host.ts#L2123-L2179](../../../../packages/sdk/src/host.ts#L2123-L2179) - `turning`, `calling`, `turnsRun`, `toolsRun`, `spanned`, `measured`"
  - "[code://packages/sdk/src/host.ts#L2252-L2341](../../../../packages/sdk/src/host.ts#L2252-L2341) - `telemetered`, which plugin/29 also reads"
  - "[code://packages/sdk/src/host.ts#L2095-L2121](../../../../packages/sdk/src/host.ts#L2095-L2121) - `asked` and `asking`, a resource that needs signing into said as the protocol's notification"
  - "[code://packages/sdk/src/host.ts#L2998-L3055](../../../../packages/sdk/src/host.ts#L2998-L3055) - `loginId`, `resourcesOf`, `agentsFor`, `lent`"
  - "[code://packages/sdk/src/host.ts#L6993-L7034](../../../../packages/sdk/src/host.ts#L6993-L7034) - `advertised`, `metadataFor`, `channelAwaiting`"
  - "[code://packages/sdk/src/host.ts#L4630-L4750](../../../../packages/sdk/src/host.ts#L4630-L4750) - `charged`, `ownerFor`, `principals`, `principalFor`, `forWhom`, `senders`, `senderOf`, `charge`, `checked`"
  - "[code://packages/sdk/src/host.ts#L4809-L4885](../../../../packages/sdk/src/host.ts#L4809-L4885) - `scoping`, `settle`"
  - "[code://packages/sdk/src/host.ts#L1745-L1807](../../../../packages/sdk/src/host.ts#L1745-L1807) - `sessionMachines`, `enteredIn`, `inMachine`, `leaveForgotten`"
  - "[code://packages/sdk/src/host.ts#L4752-L4808](../../../../packages/sdk/src/host.ts#L4752-L4808) - `machineFor`, `admitted`"
  - "[code://packages/sdk/src/host.ts#L5555-L5631](../../../../packages/sdk/src/host.ts#L5555-L5631) - `placedIn`"
---

## Goal

What the host reports about itself, what a person must sign into, whose work a session is and what it is charged to, and which machine it runs in are four files.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `principals` is written in `accept` (`:7369`) and by `authenticate`, so it is offered by the owners factory and written through it.
- `log` and `fire` are called from every area; `host.ts` destructures them.
- Open plans that cite the code this child moves: plugin/29 and its p1 (`telemetered`), plugin/20 (`ownerFor`), container/02 (`sessionMachines`), container/03 (the policy checks in `checked`), container/05, its p2, p5, p7 and p12 (`placedIn`).

### Gaps

- `turning` and `calling` are read by `telemetered` and by `dispatch`, which stays; the telemetry factory offers them.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Every factory takes the `HostContext`, and adds its area's fields to `host/context.ts` | the parent's second table, Softov's "One HostContext" | 01, 02, 03 |
| `principals`, `senders` and `charged` move into the owners factory, which offers them to the code that writes them | (defaulted: no map changes who may write it) | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Telemetry and sign-in requirements are their own files](task-01-telemetry-and-auth.md) | done | - |
| [02 - Owners and charging are one file](task-02-owners.md) | done | 01 |
| [03 - The machine a session runs in is one file](task-03-machines.md) | done | 02 |

## Resume state

- **Done so far:** built 2026-10-03, see [implemented.md](implemented.md).

## Final verification checklist

- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass; `test/otlp.test.ts`, `test/usage-meter.test.ts`, `test/session-scope.test.ts`, `test/machine-*.test.ts`, `test/policy-checks.test.ts` and `test/users-host.test.ts` cover this area.
- [x] `wc -l packages/sdk/src/host.ts` recorded in each task's Resume, 9,622 to 8,871, so 751 lines fewer.
- [x] `plans/index.md` updated - left alone on purpose, because the instructions for this run say not to edit it.
