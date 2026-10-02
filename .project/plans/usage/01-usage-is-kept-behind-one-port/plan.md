---
title: Usage is kept behind one port, model use and computer time, with live totals
domain: usage
status: built
priority: high
created: 2026-10-01
revalidated: 2026-10-01
requires: []
decisions:
  - decisions/usage-and-computer-time-are-two-records-behind-one-port.md
  - decisions/the-usage-store-answers-live-totals.md
  - decisions/work-is-owned-by-a-typed-reference.md
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L30-L41](../../../../packages/sdk/src/types/plugin.ts#L30-L41) - `PortKey`"
  - "[code://packages/sdk/src/plugins.ts#L29-L32](../../../../packages/sdk/src/plugins.ts#L29-L32) - `PORT_KEYS`"
  - "[code://packages/sdk/src/validate.ts#L126-L164](../../../../packages/sdk/src/validate.ts#L126-L164) - `PORT_MEMBERS` and `PORT_METHOD`"
  - "[code://packages/sdk/src/types/host.ts#L64-L263](../../../../packages/sdk/src/types/host.ts#L64-L263) - `HostOptions`"
  - "[code://packages/sdk/src/sessions.ts#L109-L153](../../../../packages/sdk/src/sessions.ts#L109-L153) - versioned file store, temp and rename, the pattern to copy"
  - "[code://packages/server/src/commands/run.ts#L261-L365](../../../../packages/server/src/commands/run.ts#L261-L365) - where the daemon assembles `HostOptions`"
---

## Goal

The host has a `usage` port that records model use and computer time and answers a pool's running total over a period, and the daemon gives it a JSONL store by default.
Nothing writes to it yet and nothing is enforced; the meters and the policy plans build on it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Runtime path

```
(later) proxy / agent meter / computer -> usage.record(entry) -> JSONL month file + in-memory pool totals -> usage.total(pool, from, until)
```

### Gaps

- No usage type, no port, no store.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [Model use and computer time are two record types behind one usage port](../../../decisions/usage-and-computer-time-are-two-records-behind-one-port.md) | Softov, 2026-10-01 |
| [The usage store answers a pool's live total, not only appends](../../../decisions/the-usage-store-answers-live-totals.md) | Softov, 2026-10-01 |
| [Work is owned by a typed reference, user, team or project](../../../decisions/work-is-owned-by-a-typed-reference.md) | Softov, 2026-10-01 |

| What | Source | Task |
| --- | --- | --- |
| A model use record keeps the harness's cost when there is one, and says where its cost came from (`harness` or `price`) | Softov, 2026-10-01, asked "Which price counts against budgets?": "Harness cost when present" | 01 |
| A record names the pools it was charged to as opaque keys; what a pool is belongs to the policy plan | (defaulted: policies do not exist yet) | 01, 02 |
| JSONL is the default; sqlite and postgres come as plugins on the same port | Softov, 2026-10-01: "append-only jsonL to default file, plugin for sqlite could store that and session info or more. even postgresql in a future." | 02, 03 |

## Proposed architecture

- **Data flow** - `record(entry)` appends and adds to the totals of each pool the entry names; `total(pool, from, until)` answers per measure.
- **State flow** - one JSONL file per month under the daemon's data folder; totals of open periods in memory, rebuilt from the current files at start.
- **Layer responsibilities** - `packages/sdk`: types, port, `fileUsage` · `packages/server`: wires `fileUsage` by default.
- **Source-of-truth files** - `CREATE: packages/sdk/src/types/usage.ts`, `CREATE: packages/sdk/src/usage.ts`

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The usage records and the port](task-01-records-and-port.md) | done | - |
| [02 - A JSONL store keeps live totals](task-02-jsonl-store.md) | done | 01 |
| [03 - The daemon keeps usage by default](task-03-daemon-wires-it.md) | done | 02 |

## Risks and tradeoffs

- Pool keys are opaque until the policy plan defines them; a total for a key nothing was charged to is zero.
- Rebuilding totals reads the month's files at start; large installs move to a database plugin.

## Resume state

- **Done so far:** built 2026-10-01; see [implemented.md](implemented.md).
- **Next action:** none; the agent meter and the proxy listener write to this port.
- **Open questions:** none.

## Final verification checklist

- [x] A record written, the daemon restarted, and the pool's total is the same.
- [x] `plans/index.md` updated.
