---
title: The docs say what a retained terminal is
status: done
depends: [task-02-a-subscribe-rebuilds-it.md, task-03-it-goes-with-its-turn-chat-and-session.md, task-04-a-backend-keeps-and-reads-them.md]
layer: "docs"
refs:
  - "[code://docs/sdk/TERMINALS.md#L74-L80](../../../../docs/sdk/TERMINALS.md#L74-L80) - a terminal a tool result names"
  - "[code://docs/sdk/AGENT.md](../../../../docs/sdk/AGENT.md) - the `Agent` and `Start` contract"
  - "[code://docs/sdk/AHP.md#L299-L313](../../../../docs/sdk/AHP.md#L299-L313) - the terminal channel's actions"
  - "[code://.project/specs/agent-backends.md#L125-L144](../../../../.project/specs/agent-backends.md#L125-L144) - what `Start` carries, and the terminal a tool result names"
  - "[code://CHANGELOG.md#L1-L9](../../../../CHANGELOG.md#L1-L9) - the head of the changelog"
---

## Objective

The docs, the agent backends spec and the changelog say what a retained terminal is.
They say how a backend keeps an output and reads which are kept.

## Files

- `UPDATE: docs/sdk/TERMINALS.md:3-80` - the address, a backend's released terminal, and a section on a terminal a tool result names.
- `UPDATE: docs/sdk/AGENT.md:86-142` - `Start.terminalOutputs` and the outputs a transcript read is handed.
- `UPDATE: docs/sdk/AHP.md:309` - a subscribe to an exited terminal that the host rebuilds.
- `UPDATE: .project/specs/agent-backends.md:125-144` - `Start.terminalOutputs`, and a scenario for a terminal a tool result names.
- `UPDATE: CHANGELOG.md:5-9` - a `0.14.1 - unreleased` section with one entry.

## Steps

1. Add a section on retained terminals to `TERMINALS.md`, after what a client sees.
2. Add `Start.terminalOutputs` and the transcript's outputs to `AGENT.md`.
3. Add the rebuilt snapshot to the terminal section of `AHP.md`.
4. Add `Start.terminalOutputs` and the retained terminal to the agent backends spec.
5. Add `## 0.14.1 - unreleased` above `## 0.14.0`, with one entry.

## Validation

- Each changed paragraph reads as first written, with no em dash and no double dash.
- `node .agents/skills/do-spec/scripts/lint-prose.mjs` prints nothing for the plan and the spec.

## Resume

Done 2026-10-27.
