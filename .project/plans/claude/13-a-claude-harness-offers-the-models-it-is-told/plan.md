---
title: A Claude harness offers the models it is told, written or fetched from an endpoint
domain: claude
status: planned
priority: medium
created: 2026-10-02
revalidated: 2026-10-02
requires:
  - plans/claude/12-a-second-claude-runs-on-another-endpoint/plan.md
decisions: []
refs:
  - "[code://packages/agent-claude/src/probe.ts](../../../../packages/agent-claude/src/probe.ts) - the CLI's model list, read at the probe"
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts) - `offered`, the list a session's handshake reports, which the host takes as the agent's"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `learnModels`, which replaces the agent's list from a session's"
---

## Goal

A Claude harness on another endpoint offers the models its operator names, written by id or fetched from the endpoint's model list and filtered, in the model picker; a harness with none named offers the CLI's list as today.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| The list is a plugin option, `models` | Softov, 2026-10-02, asked "Where should the list of models a Claude harness offers be written?": "Plugin option `models`" | 01 |
| An entry may fetch the endpoint's list and filter it by a pattern | Softov, 2026-10-02, asked "Should the list also be fetchable?": "Fetch, with a filter" | 01 |
| With `models` set the CLI's list is replaced; a flag adds to it instead; without `models`, the CLI's list | Softov, 2026-10-02: "keeping the cli unless models is set. if flag set.. add to it. not replace." | 01 |
| A fetch that fails is logged and its entry offers nothing | (defaulted: a down endpoint should not take the written models with it) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The models option](task-01-models-option.md) | todo | - |

## Resume state

- **Done so far:** planned 2026-10-02.
- **Next action:** [task-01-models-option.md](task-01-models-option.md).
- **Open questions:** none.

## Final verification checklist

- [ ] A harness with `models` offers them at the probe and after a session's handshake, and the CLI's list only with the flag.
- [ ] A fetched list is filtered by its pattern.
- [ ] `plans/index.md` updated.
