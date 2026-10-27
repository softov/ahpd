---
title: The docs say what a retained terminal is
status: todo
depends: [task-02-a-subscribe-rebuilds-it.md, task-03-it-goes-with-its-turn-chat-and-session.md, task-04-a-backend-keeps-and-reads-them.md]
layer: "docs"
refs:
  - "[code://docs/sdk/TERMINALS.md#L57-L71](../../../../docs/sdk/TERMINALS.md#L57-L71) - what a client sees"
  - "[code://docs/sdk/AGENT.md](../../../../docs/sdk/AGENT.md) - the `Agent` and `Start` contract"
  - "[code://docs/sdk/AHP.md#L299-L313](../../../../docs/sdk/AHP.md#L299-L313) - the terminal channel's actions"
  - "[code://.project/specs/agent-backends.md#L125-L133](../../../../.project/specs/agent-backends.md#L125-L133) - what `Start` carries"
  - "[code://CHANGELOG.md#L1-L5](../../../../CHANGELOG.md#L1-L5) - the head of the changelog"
---

## Objective

The docs, the agent backends spec and the changelog say what a retained terminal is.
They say how a backend keeps an output and reads which are kept.

## Files

- `UPDATE: docs/sdk/TERMINALS.md:57-71` - a terminal a tool result names, after it exits.
- `UPDATE: docs/sdk/AGENT.md` - `Start.terminalOutputs` and the outputs a transcript read is handed.
- `UPDATE: docs/sdk/AHP.md:299-313` - a subscribe to an exited terminal that the host rebuilds.
- `UPDATE: .project/specs/agent-backends.md:125-133` - `Start.terminalOutputs` in what `Start` carries.
- `UPDATE: CHANGELOG.md:3-5` - a `0.14.1 - unreleased` section with one entry.

## Steps

1. Add a paragraph on retained terminals to `TERMINALS.md`, after what a client sees.
2. Add `Start.terminalOutputs` and the transcript's outputs to `AGENT.md`.
3. Add the rebuilt snapshot to the terminal section of `AHP.md`.
4. Add `Start.terminalOutputs` to the scenario of the agent backends spec.
5. Add `## 0.14.1 - unreleased` above `## 0.14.0`, with one entry.

## Validation

- Each changed paragraph reads as first written, with no em dash and no double dash.
- `node .agents/skills/do-spec/scripts/lint-prose.mjs` prints nothing for the plan and the spec.

## Resume

