---
title: create_session takes an agent and a config
status: implemented
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

Built. `create_session` takes `agent` and `config` in its schema. An `agent` this host does not offer is refused with the ids it does offer; the model is filtered by that agent before any choice is made; `currentSession` passes both to `createChat` and `independent` passes both to `create`. `ToolCall.create` takes `config`, and both `create` implementations check it with `checkedConfig` for the provider and spread the host's own `isolation` and `model` over it, so those two keys win. A `config` that is not an object is refused in the tool before the host sees it. With `currentSession`, a chat of the named agent runs under its provider while the session keeps its own, and the answer's link names that agent.

The five new cases in `packages/sdk/test/sessiontools.test.ts` hold: two agents sharing a model id, with `agent` deciding which one starts the session; an unknown agent refused with both ids named; a model of the other agent refused; `config` reaching the backend and a value its schema rules out refused, and a non-object `config` refused; and `currentSession` with `agent` opening a second chat on that agent while the session's own provider stays.

Departures. `ToolCall` gained `providers()`, which no step names: naming the providers a host offers needs the agent map, and `models()` reports only what a backend has already told the host, so an agent without a model yet would be missing from it. Both call contexts answer it from the host's agents map. The Validation bullet "the tool refuses a key outside the agent's schema" is not what `checkedConfig` does - it refuses a value a declared key rules out and hands through a key the schema does not declare, which is `createChat`'s own reading - so the case refuses an enum value instead. The prose lint on `docs/sdk/TOOLS.md` reports the page's existing sentence-length findings, the new paragraph's among them.

Gates: `pnpm -s build`, `pnpm exec tsc -p tsconfig.json --noEmit`, `pnpm -s boundary` and `pnpm -s schema` pass; `packages/sdk/test/sessiontools.test.ts` passes 43 of 43.
