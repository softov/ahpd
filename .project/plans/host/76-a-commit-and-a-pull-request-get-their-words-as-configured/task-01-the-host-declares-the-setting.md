---
title: The host declares the setting
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/host/root.ts#L162-L230](../../../../packages/sdk/src/host/root.ts#L162-L230) - `ROOT_CONFIG_SCHEMA`, where the key is declared"
  - "[code://packages/sdk/src/host/changesets.ts#L109-L129](../../../../packages/sdk/src/host/changesets.ts#L109-L129) - `operationContext`, which hands the source what it needs"
---

## Objective

Root config has one key that names where a commit message and a pull request's words come from, and the changes source reads it.

## Files

- `UPDATE: packages/sdk/src/host/root.ts:178-263` - a `changeWords` key: `mode` is `session-title`, `forced`, `model` or `agent`, and `model` names a provider and a model.
- `UPDATE: packages/sdk/src/host/actions.ts:277-301` - a `model` mode naming a provider or a model this host does not serve is refused where the push is applied.
- `UPDATE: packages/sdk/src/host/changesets.ts:332-356` - `operationContext` passes the setting to the source.
- `UPDATE: packages/sdk/src/types/changes.ts` - the setting, the ask the host hands the source, and the two fields `ChangesetOperationContext` carries for them.
- `UPDATE: packages/sdk/test/root-config.test.ts` - the key, its four modes, the two refusals, and the push that names the mode and the provider in two parts.
- `UPDATE: docs/AHP.md` - the key, its modes and its default.

## Steps

1. Declare `changeWords` with the default mode `session-title`.
2. Refuse a `model` mode whose provider or model the host does not list.
3. Pass the setting through `operationContext`.

## Validation

- A root config test covers the default, each mode, and an unknown model.
- The gates pass.

## Resume

- **Implemented** 2026-10-09 on `build/agents/016ab0b2`, uncommitted.
- `packages/sdk/src/host/root.ts:228-263` declares `changeWords` in `ROOT_CONFIG_SCHEMA.properties`. `mode` is required and defaults to `session-title`; `provider` and `model` are optional, each with a description. `docs/AHP.md` names the key among the ones this host acts on, and the section on an operation's arguments carries the four modes.
- `packages/sdk/src/host/actions.ts:277-301` refuses a `model` mode that names something this host cannot ask, before any part of the write is applied.
- `packages/sdk/src/types/changes.ts` declares `ChangeWordsMode`, `ChangeWordsSetting`, `ChangeWordsAsk` and `ChangeWords`, and the two fields `ChangesetOperationContext` carries: `changeWords` and `conversation`. `packages/sdk/src/host/changesets.ts:332-356` builds the setting on the context.
- `packages/sdk/test/root-config.test.ts` (25 tests) covers the default, each of the four modes, both refusals, and a push that names the mode and the provider in two parts.
- **Departure 1.** The refusal reads the setting the root would hold after the write - the value held merged with the push, or `{}` when the push is a `replace` - rather than what this one push carries. A client that sets the mode in one push and the provider in the next is not refused for the gap between them, and a test pushes the two halves separately to pin that.
- **Departure 2.** A `model` mode that names no provider is taken here and answered at the operation instead, where the commit falls back to the session title and says why - see task 03. A refusal would leave the mode unreachable in two steps. A model name is checked only when the host holds a list for the provider: an empty list is a harness nobody has signed into yet, so there is nothing to contradict the name with.
- Gates: `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
