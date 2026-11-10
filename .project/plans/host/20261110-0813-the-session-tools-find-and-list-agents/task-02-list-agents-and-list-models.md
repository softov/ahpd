---
title: list_agents and list_models
status: implemented
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

Implemented 2026-11-10. `list_agents` answers each agent the caller may start - its `agent` id, its `name`, the `config` schema `sessionSchema` folds for it, and its first five models - and `list_models` answers one agent's models or every agent's, in the order the host learned them; both are `sessionless`, ask `session:read`, and take their list from a new `ToolCall.agents()`, so what they answer and what a start later refuses come from one place (`mayUseAgent` in `host/tooling.ts`, wired into both tool contexts). `modelMeant` now names `list_models` when it refuses a model. A call with no person behind it (`nobody`) is told no recorded agent; a root call, or a host with no users directory, keeps every agent. Cases in `packages/sdk/test/sessiontools.test.ts` cover a caller with two agents, a caller with none, the first-five cut, one agent's models alone, and a refusal for an agent the caller may not start; the two tool-name lists in `host-github.test.ts` and `host-tools.test.ts` gain both names. `docs/server/MCP.md` and `docs/sdk/TOOLS.md` name both tools, the guest's four, and the member's nine; one line is added to `docs/updates/v0_15.md` under *Unreleased*. Gates: typecheck clean, `sessiontools` 58 passed, `host-github` and `host-tools` 122 passed.

