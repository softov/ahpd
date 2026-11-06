---
title: A failed open says why
domain: plugin
status: built
priority: medium
created: 2026-11-05
revalidated: 2026-11-05
refs:
  - git://8febc0ea - the commit of ahpd the facts were checked at
  - "[code://packages/sdk/src/agents/channel.ts#L449-L456](../../../../packages/sdk/src/agents/channel.ts#L449-L456) - a record that does not open at start is logged, and its row says only `invalid`"
  - "[code://packages/sdk/src/agents/channel.ts#L876-L886](../../../../packages/sdk/src/agents/channel.ts#L876-L886) - `check` puts the same error on the row's `health`, which ahpw draws"
  - "[code://packages/sdk/src/connectors/channel.ts#L1535-L1538](../../../../packages/sdk/src/connectors/channel.ts#L1535-L1538) - the same gap for a connector"
---

## Goal

An agent or a connector that does not open at start says why on its row.
Softov, 2026-11-05, saw four agents fail with "the environment holds no DEEPSEEK_API_KEY" in the log: "But agents has no alerts to show."

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Runtime path

```
start -> openAll -> open fails -> log line; row state invalid, no reason
```

### Gaps

- The reason is in the daemon's log only.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A failed open writes `health: { result: 'failed', message }` on the row, as `check` does, in the agents and the connectors channels | Softov, 2026-11-05, chose "Health, agents and connectors" | 01 |
| A later open that succeeds removes that health | (defaulted: a reason that no longer holds is wrong on the row) | 01 |
| A connector keeps the reason under `health.check`, cut to 500 characters | (defaulted: the field and the limit a connector check uses) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a failed open goes on the row](task-01-a-failed-open-goes-on-the-row.md) | done | - |

## Resume state

- **Done so far:** task 01 is implemented on 2026-11-05.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** nothing open.

## Final verification checklist

- [x] `pnpm --filter @ahpd/sdk test` passes, run alone.
- [x] `pnpm typecheck` and `pnpm boundary` pass.
