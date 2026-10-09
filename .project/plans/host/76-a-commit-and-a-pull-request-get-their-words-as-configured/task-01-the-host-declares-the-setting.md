---
title: The host declares the setting
status: todo
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/host/root.ts#L162-L230](../../../../packages/sdk/src/host/root.ts#L162-L230) - `ROOT_CONFIG_SCHEMA`, where the key is declared"
  - "[code://packages/sdk/src/host/changesets.ts#L109-L129](../../../../packages/sdk/src/host/changesets.ts#L109-L129) - `operationContext`, which hands the source what it needs"
---

## Objective

Root config has one key that names where a commit message and a pull request's words come from, and the changes source reads it.

## Files

- `UPDATE: packages/sdk/src/host/root.ts:162-230` - a `changeWords` key: `mode` is `session-title`, `forced`, `model` or `agent`, and `model` names a provider and a model.
- `UPDATE: packages/sdk/src/host/changesets.ts:109-129` - `operationContext` passes the setting to the source.
- `UPDATE: docs/AHP.md` - the key, its modes and its default.

## Steps

1. Declare `changeWords` with the default mode `session-title`.
2. Refuse a `model` mode whose provider or model the host does not list.
3. Pass the setting through `operationContext`.

## Validation

- A root config test covers the default, each mode, and an unknown model.
- The gates pass.

## Resume
