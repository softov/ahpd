---
title: A usage list shows the charged pools a reader may read, names them, and sums any range by user, team and project
domain: usage
status: built
priority: high
created: 2026-10-09
revalidated: 2026-10-09
requires: []
changes: []
creates: []
decisions:
  - decisions/usage-lists-the-charged-pools-a-reader-may-read.md
  - decisions/usage-is-grouped-by-the-host.md
refs:
  - "[code://packages/sdk/src/usage.ts#L520-L545](../../../../packages/sdk/src/usage.ts#L520-L545) - `refused`, `notYours` and `visible`, the read rule and the list"
  - "[code://packages/sdk/src/usage.ts#L558-L590](../../../../packages/sdk/src/usage.ts#L558-L590) - `body`, the totals and the records a read answers"
  - "[code://packages/sdk/src/usage.ts#L405-L445](../../../../packages/sdk/src/usage.ts#L405-L445) - `LEAVES`, `split` and `at`, how a `usage://` URI is read"
  - "[code://packages/sdk/src/scopes.ts#L95-L131](../../../../packages/sdk/src/scopes.ts#L95-L131) - `namesOf` and `poolsFor`; a `team:*` is crossed with every project, and no `team:` pool comes from a project membership"
  - "[code://packages/sdk/src/meter.ts#L190-L205](../../../../packages/sdk/src/meter.ts#L190-L205) - the meter charges a scoped record to its `team:` pool too"
  - "[code://packages/sdk/src/types/usage.ts#L128-L165](../../../../packages/sdk/src/types/usage.ts#L128-L165) - the `Usage` port"
  - "[code://packages/sdk/src/host/admission.ts#L136-L172](../../../../packages/sdk/src/host/admission.ts#L136-L172) - every `usage:` read is gated as `usage:get`"
  - "[code://docs/USAGE.md](../../../../docs/USAGE.md) - the scheme as documented"
---

## Goal

A person and root see the same rows for the same work, each named as a person reads it.
A total is read for any range, not only today, this week and this month.
Spending is summed by user, team, project or any mix of them, each record counted once.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- 2026-10-09, Softov's daemon: as root, the list is `team:backend`, `project:backend:ahpapp`, `user:soft`, `root:soft-sandbox`.
- 2026-10-09, the same daemon as `soft`: the list is `user:soft` and four `project:` pools, three of them empty, and no `team:backend`.
- `~/.config/ahpd/users.json`: `soft` holds `backend:*`, `testing:*` and `backend:ahpapp`, and the role `developer`, which has no `team` or `project` grant.

### Gaps

- `team:*` gives no `team:` pool, so a member cannot read the team pool their own work is charged to.
- A listing entry is a bare pool key, and a client needs `team` and `project` grants to name it.
- Totals take only the three fixed periods, though `Usage.total` takes any range.
- Nothing sums records by user, team or project.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [The usage list shows the charged pools a reader may read](../../../decisions/usage-lists-the-charged-pools-a-reader-may-read.md) | Softov, 2026-10-09 |
| 2 | [Usage is grouped by the host](../../../decisions/usage-is-grouped-by-the-host.md) | Softov, 2026-10-09 |

| What | Source | Task |
| --- | --- | --- |
| A member of `team:*` or of `team:project` reads `team:<team>` | [`usage-is-read-through-a-usage-scheme`](../../../decisions/usage-is-read-through-a-usage-scheme.md): a person reads "the `team:` and `project:` pools they are a member of" | 01 |
| `team:*` lets a person read `project:<team>:<any>`, not the install's project list crossed with the team | the same decision | 01 |
| ahpd sends each pool's kind and name | Softov, 2026-10-07, in ahpapp `usage/01`: "ahpd sends kind and name" | 03 |
| A total is read for any range, and the records follow the same range | Softov, 2026-10-09, asked "How should a custom date range be picked?" and answered "A fourth tab, Range" | 04 |

## Proposed architecture

- **The read rule** - `poolsFor` stays the list of pools a person may name. A new `mayRead(principal, pool)` in `scopes.ts` answers for any pool key, so `team:*` matches `project:<team>:<any>` and `team:<team>`.
- **The list** - `store.pools()` filtered by the read rule, for every reader.
- **A pool's body** - `usage://<pool>` gains `kind` (`user`, `team`, `project`, `root`) and `name`. The name is the user's, the team's title, or `<team title> / <project title>`, each falling back to its id.
- **A range** - `usage://<pool>/range?from=&until=` answers one total. The `records` leaf already takes `from` and `until`.
- **Groups** - `usage://groups?by=user,team,project&from=&until=` answers one row per distinct key tuple: the keys, a name for each, and the total. `groups` is not a pool key, because a pool key holds a `:`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A member reads their team's pool](task-01-a-member-reads-their-teams-pool.md) | done | - |
| [02 - The list shows charged pools the reader may read](task-02-the-list-shows-charged-pools-the-reader-may-read.md) | done | 01 |
| [03 - A pool says its kind and name](task-03-a-pool-says-its-kind-and-name.md) | done | - |
| [04 - A total is read for any range](task-04-a-total-is-read-for-any-range.md) | done | - |
| [05 - Usage is summed by user, team and project](task-05-usage-is-summed-by-user-team-and-project.md) | done | 01, 03, 04 |

## Risks and tradeoffs

- A store plugin must answer the grouped total. The file store reads the month files, which is slower than a pool total on a long range.
- A pool name reads people records the reader has no grant for. Only the title goes out, and only for pools the reader may read.

## Resume state

- **Done so far:** tasks 01-05 are done. Merged 2026-10-09 as 9e38af1. [implemented.md](implemented.md) lists the files and the departures.
- **Next action:** none. ahpapp `usage/04` builds the screen on these reads.
- **Open questions:** none.
- **Watch out for:** a record charged to three pools counts once in a group, and three times across pool rows.

## Final verification checklist

- [ ] As `soft`, the list is `user:soft`, `team:backend` and `project:backend:ahpapp`, the same rows root sees for them.
- [ ] Each pool body has a `kind` and a `name` that a reader with no `team` or `project` grant gets.
- [ ] `range`, `records` and `groups` take `from` and `until`.
- [ ] A group by `user,project` sums each record once.
- [ ] `docs/USAGE.md` describes the list, the name, the range and the groups.
- [ ] `plans/index.md` updated.
