---
title: A client reads what a pool spent, and the records behind it, through a usage scheme
domain: usage
status: planned
priority: high
created: 2026-10-02
revalidated: 2026-10-02
requires:
  - plans/usage/02-a-turn-writes-what-it-used/plan.md
  - plans/usage/03-a-machine-writes-its-up-time/plan.md
  - plans/host/36-people-are-resources-a-client-manages/plan.md
changes: []
creates: []
decisions:
  - decisions/usage-is-read-through-a-usage-scheme.md
  - decisions/the-usage-store-answers-live-totals.md
refs:
  - "[code://packages/sdk/src/types/usage.ts](../../../../packages/sdk/src/types/usage.ts) - `Usage.record` and `total`; no way to read records yet"
  - "[code://packages/sdk/src/usage.ts](../../../../packages/sdk/src/usage.ts) - `fileUsage`, monthly JSONL files and per-day totals"
  - "[code://packages/sdk/src/users.ts#L23-L39](../../../../packages/sdk/src/users.ts#L23-L39) - `SUBJECTS`, where `usage` joins"
  - "[code://packages/computer/src/provider.ts](../../../../packages/computer/src/provider.ts) - a scheme provider with `describe()`, the shape to mirror"
  - "[code://packages/sdk/src/scopes.ts](../../../../packages/sdk/src/scopes.ts) - a principal's memberships, which decide the pools they read without a grant"
  - "[code://packages/sdk/src/host.ts#L6766-L6855](../../../../packages/sdk/src/host.ts#L6766-L6855) - `capabilityFor` and `admit`, the gate a scheme's own-pool rule has to pass"
  - "[code://packages/sdk/src/meter.ts#L159-L171](../../../../packages/sdk/src/meter.ts#L159-L171) - `poolsOf`, the spelling a record was charged under"
  - "[code://packages/server/src/commands/run.ts#L355-L363](../../../../packages/server/src/commands/run.ts#L355-L363) - the daemon's own store, which the provider and the command share"
  - "[code://packages/server/src/commands/user.ts#L34-L41](../../../../packages/server/src/commands/user.ts#L34-L41) - `bounded`, the in-body check `ahpd usage` copies"
  - file:///github/ahp-review/prospect/ahp-user-rules.md - the rules draft that settled the week, at "A week is calendar based, Monday 00:00 in a configured timezone"
---

## Goal

A person opens ahpapp, or runs `ahpd usage`, and sees what their own pool, their teams and their projects spent today, this week and this month, and the records behind it; someone with `usage:read` sees every pool.

## Reconnaissance

### Runtime path

```
meters -> Usage.record -> fileUsage (monthly JSONL, per-day totals) -> Usage.total(pool, from, until) -> nobody
```

### Gaps

- No scheme, no grant subject, no command reads usage.
- The port cannot list records.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| [A `usage:` scheme, totals and records, own pools readable without a grant](../../../decisions/usage-is-read-through-a-usage-scheme.md) | Softov, 2026-10-02 | 01, 02 |

| What | Source | Task |
| --- | --- | --- |
| `usage:///` lists the pools the reader may see; `usage:///<pool>` reads `{ day, week, month }`, each a `UsageTotal`; `usage:///<pool>/records?from=&until=` lists the records, newest first | (defaulted: a pool name holds colons, so it is one encoded path segment rather than an authority) | 02 |
| A week starts Monday 00:00 and a day at midnight in `usage.timezone` from the daemon config, the system's own zone by default | rules draft, settled: "A week is calendar based, Monday 00:00 in a configured timezone"; the key name is (defaulted) | 02, 03 |
| `Usage` gains `records(pool, from, until)`; `fileUsage` answers it from its monthly files | (defaulted: the port is the only reader of the store) | 01 |
| The scheme is served only when the host has a `usage` port; `usage` has `read` and no `write` | (defaulted: nothing to read without a store; records are written by meters only) | 02 |
| `ahpd usage [pool]` prints the same totals, declared once like the other commands | daemon/04: commands are declared once and rendered as CLI and `/api` | 03 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The usage port names its pools and reads a pool's records back](task-01-the-port-reads-back.md) | todo | - |
| [02 - The host serves usage as a scheme, and a person reads their own pools without the grant](task-02-the-usage-scheme.md) | todo | 01 |
| [03 - The daemon reads `usage.timezone` and `ahpd usage` prints what a pool has spent](task-03-usage-timezone-and-the-command.md) | todo | 02 |
| [04 - The docs name the usage subject, the scheme and the command](task-04-docs.md) | todo | 03 |

## Resume state

- **Done so far:** planned 2026-10-02, task files written 2026-10-02.
- **Next action:** [task-01-the-port-reads-back.md](task-01-the-port-reads-back.md).
- **Open questions:**
  1. How is the `usage:` scheme let past the host's own gate for a person's own pools, and how does the provider learn who is asking? `capabilityFor` turns every `usage:` URI into `usage:read` and `admit` throws before the provider is reached, and `resourceList` / `resourceRead` hand it nothing. - proposed: `ResourceProvider` gains an optional `authorize?(uri, reader)`, awaited by `capabilityFor` before the scheme's grant is added, and `resourceList` / `resourceRead` pass `connection.principal` the way `resourceWrite` already passes `owner`. Task 02, step 11.
  2. What does `usage://<pool>/records` answer when `from` or `until` is left out, and how many records does it return? - proposed: an absent `from` is the first day of the current month and an absent `until` is now, and the answer is the newest 200 records and never more. Task 01, step 6.
  3. What does the daemon do with a `usage.timezone` no runtime on this host can resolve? - proposed: say it once at start and use the system's own zone, rather than refusing the run over a reporting key. Task 03, step 9.

## Final verification checklist

- [ ] A person with no grant lists their own, their teams' and their projects' pools and reads each; another person's pool is refused.
- [ ] With `usage:read`, every pool is listed.
- [ ] A pool's day, week and month totals match its records, with the week from Monday in the configured zone.
- [ ] `ahpd usage` prints the same.
- [ ] `usage/00-usage.md` and `plans/index.md` updated.
