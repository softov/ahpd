---
title: create_session takes an agent and a config
status: todo
depends:
  - task-01-a-host-tool-may-run-with-no-session.md
layer: sdk
refs:
  - "[code://packages/sdk/src/tools/session.ts#L285-L291](../../../../packages/sdk/src/tools/session.ts#L285-L291) - `modelMeant`, which takes the first model with an id across all providers"
  - "[code://packages/sdk/src/tools/session.ts#L444-L500](../../../../packages/sdk/src/tools/session.ts#L444-L500) - `create_session`"
  - "[code://packages/sdk/src/types/host.ts#L1099-L1128](../../../../packages/sdk/src/types/host.ts#L1099-L1128) - `create` and `createChat` on `ToolCall`; `createChat` already takes `provider` and `config`"
  - "[code://packages/sdk/src/host/tooling.ts#L1577-L1630](../../../../packages/sdk/src/host/tooling.ts#L1577-L1630) - `openChat`, which checks a chat's `config` with `checkedConfig`"
  - "[code://packages/sdk/src/host/tooling.ts#L1724-L1778](../../../../packages/sdk/src/host/tooling.ts#L1724-L1778) - `create`, which builds the new session's config"
---

## Objective

`create_session` takes `agent`, a provider id, and `config`, the new session's settings.
The host checks `config` against that agent's schema, as `createChat` checks a chat's.

## Files

- `UPDATE: packages/sdk/src/tools/session.ts:444-500` - the `agent` and `config` inputs, and their checks.
- `UPDATE: packages/sdk/src/types/host.ts:1099-1108` - `config?: Record<string, unknown>` on `create`.
- `UPDATE: packages/sdk/src/host/tooling.ts:1724-1778` - merge the checked `config` into the new session's config, in both contexts.
- `UPDATE: packages/sdk/test/sessiontools.test.ts` - the `agent` and `config` cases.
- `UPDATE: docs/sdk/TOOLS.md` - the two inputs.

## Steps

1. Add `agent` to the `create_session` schema: "Optional provider id of the agent to run, such as one `list_sessions` shows. Defaults to the model's provider, then the current session's".
2. Add `config` to the schema: "Optional settings for the new session, as the agent's config schema names them".
3. Refuse an `agent` that is not a provider this host offers, and name the providers it offers.
4. Pass `agent` to `modelMeant` as the provider, so `model` must belong to that agent.
5. For `currentSession`, pass `agent` as `provider` and `config` to `createChat`.
6. For `independent`, pass `agent` as `provider` and `config` to `create`.
7. Add `config` to `ToolCall.create`.
8. In `create`, check `config` with `checkedConfig` for the provider, as `openChat` does.
9. Merge the checked `config` under the host's `isolation` and `model` keys.
10. Refuse a `config` that is not an object.
11. Write the two inputs in `docs/sdk/TOOLS.md`.

## Validation

- `packages/sdk/test/sessiontools.test.ts` holds: `agent` picks that provider when two providers share a model id.
- The same file holds: the tool refuses an unknown `agent` and names the providers.
- The same file holds: the tool refuses a `model` of another agent.
- The same file holds: `config` reaches the new session, and the tool refuses a key outside the agent's schema.
- The same file holds: `currentSession` with `agent` makes a chat of that agent.
- `pnpm --filter @ahpd/sdk test -- sessiontools` passes.
- `pnpm typecheck` passes.

## Resume
