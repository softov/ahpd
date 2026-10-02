---
title: A turn writes what it used to the usage store, charged to its owner, team and project
domain: usage
status: planned
priority: high
created: 2026-10-02
revalidated: 2026-10-02
requires:
  - plans/usage/01-usage-is-kept-behind-one-port/plan.md
  - plans/host/34-work-says-who-owns-it/plan.md
  - plans/host/35-a-person-belongs-to-teams-and-projects/plan.md
changes: []
creates: []
decisions:
  - decisions/the-agent-meter-writes-per-turn-or-per-report.md
  - decisions/agent-usage-is-charged-to-owner-team-and-project-pools.md
  - decisions/usage-and-computer-time-are-two-records-behind-one-port.md
refs:
  - "[code://packages/sdk/src/types/usage.ts](../../../../packages/sdk/src/types/usage.ts) - `ModelUse`, `UsageBase`, the `Usage` port"
  - "[code://packages/sdk/src/host.ts#L3585-L3600](../../../../packages/sdk/src/host.ts#L3585-L3600) - the dispatch loop, where a turn's sender is read and let go of"
  - "[code://packages/sdk/src/host.ts#L3651-L3660](../../../../packages/sdk/src/host.ts#L3651-L3660) - the three ways a turn ends, as `settleRun` reads them"
  - "[code://packages/sdk/src/host.ts#L4170-L4240](../../../../packages/sdk/src/host.ts#L4170-L4240) - `charged`, `ownerFor`, `senders`: the owner and scope a record takes"
  - "[code://packages/agent-claude/src/session.ts#L2838-L2853](../../../../packages/agent-claude/src/session.ts#L2838-L2853) - Claude's final report, cost in `_meta.cost`"
  - "[code://packages/agent-cofold/src/mapping.ts#L104-L124](../../../../packages/agent-cofold/src/mapping.ts#L104-L124) - cofold's report, cost as `{ amount, currency }` in `_meta.cost`"
  - "[code://packages/agent-acp/src/session.ts#L109-L115](../../../../packages/agent-acp/src/session.ts#L109-L115) - ACP's cost is per session, turned into a turn's by difference"
  - "[code://packages/server/src/commands/run.ts#L357](../../../../packages/server/src/commands/run.ts#L357) - where the daemon passes the usage store"
---

## Goal

Every turn an agent runs on a host with a `usage` port leaves a model record (`source: 'agent'`) with its tokens, its cost when the harness reported one, who sent it, the team and project it is charged under, the session, chat, turn, agent and computer, charged to the owner's, team's and project's pools.
A daemon configured for it writes one record per report instead of one per turn.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| [One record per turn, or per report when configured](../../../decisions/the-agent-meter-writes-per-turn-or-per-report.md) | Softov, 2026-10-02 | 01, 02 |
| [Pools are owner, `team:<team>` and `project:<team>:<project>`](../../../decisions/agent-usage-is-charged-to-owner-team-and-project-pools.md) | Softov, 2026-10-02 | 01 |
| [Records share one base; model records nest `model`](../../../decisions/usage-and-computer-time-are-two-records-behind-one-port.md) | Softov, 2026-10-01 | 01 |

| What | Source | Task |
| --- | --- | --- |
| The owner is the turn's sender, else the session's owner | host/34: a turn belongs to who sent it | 01 |
| `model.name` is what the harness reported, as it spelled it; `model.provider` is left out | (defaulted: mapping a harness's id to `<maker>/<name>` is the proxy's model table, not this plan) | 01 |
| A cost is kept only as the harness reported it (`from: 'harness'`); none is worked out | prices are usage/05 | 01 |
| A host with no `usage` port writes nothing and the meter costs nothing | usage/01: the port is optional | 01 |
| A record that cannot be written is logged and the turn is not affected | (defaulted: metering never fails work) | 01 |
| The setting is `usage.per` in the daemon config, `turn` (default) or `report` | (defaulted name) | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host meters turns](task-01-the-host-meters-turns.md) | todo | - |
| [02 - The daemon chooses per turn or per report](task-02-per-turn-or-per-report.md) | todo | 01 |

## Resume state

- **Done so far:** nothing.
- **Next action:** task 01.
- **Open questions:** none.

## Final verification checklist

- [ ] A completed, a cancelled and a failed turn each leave one record with the turn's last report, its owner, scope and pools.
- [ ] Per report, the records of one turn sum to its last report.
- [ ] A turn on a host with no users, or with no teams, writes a record charged to no pool.
- [ ] Worker chats are not counted twice.
- [ ] `usage/00-usage.md` runtime path updated; `plans/index.md` updated.
