---
title: A cofold run is told the model reference it runs on, and cofold stores it as given
status: accepted
date: 2026-09-27
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L333-L355](../../packages/agent-cofold/src/agent.ts#L333-L355) - `modelOf`, which builds the adapter with the bare model id"
  - file:///github/cofold/packages/model-openai-compat/src/index.ts - the adapter's `id`, `openai-compat:<host>`
  - file:///github/cofold/packages/agents/src/types/store.ts - `RunRecord`
---

## Context

A client picks a cofold model by the reference `<provider>/<model>`, and decision [a-cofold-turns-model-is-kept-in-cofolds-store](a-cofold-turns-model-is-kept-in-cofolds-store.md) keeps what a run used on its `RunRecord`.
What cofold knows of a run's model is its adapter: `id` is `openai-compat:<host>` and `modelId` is the bare model id, so neither gives the reference back.

## Decision

agent-cofold passes the `<provider>/<model>` reference it resolved as an option of each run, and `@cofold/agents` stores it on the `RunRecord` as given, without reading or building it.

Source: Softov, 2026-09-27, asked "cofold's adapter knows only `openai-compat:<host>` and the bare model id, so neither gives back `<provider>/<model>`. How should the reference reach `RunRecord`?": "Run option".

## Consequences

The backend names what it chose, and cofold stays free of any provider scheme.
A run started without the option records no model, and its turn is rebuilt without one.

## Options

- **The adapter's `name`**: agent-cofold names the adapter by provider so `id` reads `openai-compat:<provider>`, and the backend rebuilds the reference from `id` and `modelId`; it ties the reference to one adapter's id format.
- **`AgentDefinition.model`**: the reference goes on the agent's definition and cofold copies it to each run; it ties the stored value to how an agent is defined, while the model can change per turn.
