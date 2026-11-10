---
title: create_session names the agents
status: todo
depends:
  - task-02-list-agents-and-list-models.md
layer: "sdk"
refs:
  - "[code://packages/sdk/src/tools/session.ts#L506-L530](../../../../packages/sdk/src/tools/session.ts#L506-L530) - `create_session` and its `agent`"
---

## Objective

`create_session`'s `agent` input is an enum of the agents the caller may start, with each agent's name in its description, built for each caller.

## Files

- `UPDATE: packages/sdk/src/tools/session.ts:506-530` - the `agent` input, built per caller.
- `UPDATE: packages/sdk/test` - the case of the enum.

## Steps

1. Build `create_session`'s definition for each caller, as the host builds the sessionless tools for each caller.
2. Set `agent.enum` to the caller's agent ids.
3. Name each agent in the input's description, as `<id>: <name>`, one per line.
4. Say in the description that `list_models` names an agent's models.
5. Keep the refusal of an id that is not in the enum.

## Validation

- Two callers with different agents see different enums.
- `pnpm typecheck`, then the sdk and server suites.

## Resume

