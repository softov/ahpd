---
title: The docs say what an approval offers on each backend
status: todo
depends: [task-02-an-acp-agents-options-are-offered.md, task-03-claude-offers-always-allow.md, task-04-cofold-offers-allow-for-the-session.md]
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) - the backends' sections and the `Session` seam"
  - "[code://UPSTREAM.md](../../../../UPSTREAM.md) - the protocol features ahpd sends"
---

## Objective

`docs/PLUGINS.md` says that `confirm` receives the picked option and what each backend offers, and `UPSTREAM.md` ticks confirmation options.

## Files

- `UPDATE: docs/PLUGINS.md` - the `confirm` signature; one sentence per backend on its options; pi offers none.
- `UPDATE: UPSTREAM.md` - confirmation options and `selectedOptionId`.
- `UPDATE: packages/agent-acp/README.md`, `packages/agent-claude/README.md`, `packages/agent-cofold/README.md` - where each describes approvals.

## Steps

1. Match each file's existing style; no em dash.

## Validation

- Every sentence re-read against the code; every relative link resolves.

## Resume
