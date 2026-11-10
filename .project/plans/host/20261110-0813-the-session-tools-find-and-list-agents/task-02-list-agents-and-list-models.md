---
title: list_agents and list_models
status: todo
depends: []
layer: "sdk, docs"
refs:
  - "[code://packages/sdk/src/tools/session.ts](../../../../packages/sdk/src/tools/session.ts) - `sessionTools`, where the two tools join"
---

## Objective

`list_agents` answers each agent the caller may start, with its id, its name, its config schema and its first five models.
`list_models` answers one agent's models, or every agent's.

## Files

- `UPDATE: packages/sdk/src/tools/session.ts:406` - two read tools in `sessionTools`, `sessionless`, with `readOnlyHint`.
- `UPDATE: packages/sdk/test` - the cases of both tools.
- `UPDATE: docs/server/MCP.md:43-61` - both tools.
- `UPDATE: docs/sdk/TOOLS.md` - both tools.

## Steps

1. Read the agents the caller may start, as `create_session` reads them to refuse a wrong `agent`.
2. Answer for each agent its `agent` id, its name, its config schema and its first five models.
3. Give `list_models` an optional `agent`, and answer that agent's models, or every agent's.
4. Answer each model with its id and its name, as `create_session`'s `model` takes them.
5. Make `modelMeant` name `list_models` when it refuses a model.
6. Give both tools the grant `session:read`.

## Validation

- A caller with two agents gets two rows, and a caller with none gets an empty list.
- `list_models { agent }` answers that agent's models only.
- `pnpm typecheck`, then the sdk suite.

## Resume

