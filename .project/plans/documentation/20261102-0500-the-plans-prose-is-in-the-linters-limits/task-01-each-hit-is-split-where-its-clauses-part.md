---
title: Each hit is split where its clauses part
status: todo
depends: []
layer: "plans"
refs:
  - "[code://.agents/skills/do-spec/scripts/lint-prose.mjs](../../../../.agents/skills/do-spec/scripts/lint-prose.mjs) - the linter"
---

## Objective

Each of the 63 hits becomes sentences within the limits, saying what the long one said.

## Files

- `UPDATE: .project/plans/claude/20261031-2133-an-mcp-server-a-client-starts-or-stops-is-answered-by-its-state/` - plan, task-01, task-02.
- `UPDATE: .project/plans/cofold/20261031-2319-every-turn-and-steering-message-is-answered/` - plan, implemented, task-02.
- `UPDATE: .project/plans/host/20261031-2050-a-customization-switch-is-answered/` - plan, implemented, task-01.
- `UPDATE: .project/plans/host/20261031-2222-every-client-action-is-answered/` - plan, task-01, task-02, task-04, task-05.
- `UPDATE: .project/plans/host/20261101-0022-a-state-change-is-said-to-every-subscriber/` - plan, implemented, task-01, task-02, task-03.

## Steps

1. Run the linter over the 72 files #183 merged.
2. Read each hit's line, and split it where its clauses part.
3. Make the one passive step active.
4. Run the linter again.

## Validation

- The linter exits 0 over the 72 files.

## Resume

Not started.
