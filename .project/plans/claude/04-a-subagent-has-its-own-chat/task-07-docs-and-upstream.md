---
title: Docs and upstream
status: implemented
depends: [task-04-a-subagent-turn-ends.md, task-05-asks-inside-a-subagent.md, task-06-restored-after-a-restart.md]
layer: "docs"
refs:
  - "[code://UPSTREAM.md](../../../../UPSTREAM.md) - where the subagent parity is recorded"
---

## Objective

The docs say a subagent is its own chat, and `UPSTREAM.md` records the parity.

## Files

- `UPDATE: packages/agent-claude/README.md`, `docs/PLUGINS.md` (the `Start.subagent` seam), `UPSTREAM.md`, `.project/plans/index.md`.

## Steps

1. One paragraph in the agent-claude README; the seam in the plugin docs.
2. Tick or add the subagent line in `UPSTREAM.md`.

## Validation

- The docs read as written by a person, short, one paragraph per line.

## Resume

Built. `packages/agent-claude/README.md` has one paragraph on the subagent chat and a `subagentsOf` row in the exports table; `docs/PLUGINS.md` has "A backend's worker chats", the `Start.subagent` seam and what it hands back; `UPSTREAM.md` has the ticked subagent line under "What a client is told about a session".

`.project/plans/index.md` is kept by the main session, which lists this plan there.

