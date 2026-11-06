---
title: A plugin registers connector kinds
status: done
depends: [task-02-a-registration-is-checked.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L654-L1033](../../../../packages/sdk/src/types/plugin.ts#L654-L1033) - `PluginHost`, which gets `registerConnector`"
  - "[code://packages/sdk/src/types/plugin.ts#L1143](../../../../packages/sdk/src/types/plugin.ts#L1143) - `Contribution`, which gets `connectors`"
  - "[code://packages/sdk/src/types/host.ts#L135-L142](../../../../packages/sdk/src/types/host.ts#L135-L142) - `HostOptions.channels`, the pattern for `connectorKinds`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L282](../../../../packages/sdk/src/plugins/plugins.ts#L282) - `foldHostOptions`"
---

## Objective

A plugin registers one or more connector kinds with `registerConnector`.
A kind has a name, a title, a description, a configuration schema, a list of capabilities and an `open` function.
The fold collects every kind in `HostOptions.connectorKinds`, by name.

## Files

- `CREATE: packages/sdk/src/types/connectors.ts` - `ConnectorKind`, `Capability`, `Connector` and `ConnectorOwner`.
- `UPDATE: packages/sdk/src/types/index.ts` - export the new types.
- `UPDATE: packages/sdk/src/types/plugin.ts:654-1033` - add `registerConnector(kind)` to `PluginHost`.
- `UPDATE: packages/sdk/src/types/plugin.ts:1143` - add `connectors` to `Contribution`.
- `UPDATE: packages/sdk/src/types/host.ts:135-142` - add `connectorKinds` to `HostOptions`.
- `UPDATE: packages/sdk/src/plugins/plugins.ts` - record the kind in `pluginHost`, and fold it in `foldHostOptions`.
- `UPDATE: packages/sdk/src/plugins/validate.ts` - check a kind's shape.
- `UPDATE: packages/sdk/test/plugin-fold.test.ts` - the cases below.

## Steps

1. Write `Capability` with `type`, `name`, `title`, `description` and an optional `input` schema.
2. Allow the types `receive`, `command`, `action` and `ui`, and accept any other string.
3. Write `ConnectorKind` with `name`, `title`, `description`, `schema`, `capabilities` and `open`.
4. Make `open(connector)` answer a `close` function, or nothing.
5. Write `Connector` with `id`, `kind`, `owner`, `title` and `config`.
6. Add `registerConnector` to `PluginHost`, checked against the `connectors` contract.
7. Refuse a kind whose name is not a slug, or whose schema is not an object.
8. Refuse a second kind with the same name, from the same plugin or another one.
9. Fold the kinds into `HostOptions.connectorKinds`, each with the plugin that registered it.
10. Run the SDK plugin tests, and set this task and the plan row to `done`.

## Validation

- `plugin-fold.test.ts`: one plugin registers two kinds, and `connectorKinds` holds both.
- `plugin-fold.test.ts`: two plugins that register the same kind name fail, and the message names both.
- `plugin-fold.test.ts`: the host refuses a kind with no `schema`.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** `packages/sdk/src/types/connectors.ts` holds `CapabilityType`, `Capability`, `ConnectorOwner`, `Connector`, `ConnectorKind` and `ServedConnectorKind`, all exported from `types/index.ts` and so from the package. `CapabilityType` is the four names plus `(string & {})`, so a type this version does not know is kept and shown. `ServedConnectorKind` is a kind with the `by` the fold records. `PluginHost.registerConnector(kind)` checks the shape with `checkConnectorKind`, checks the name against `contracts.connectors`, refuses a name the same plugin reused, and records `{ ...kind, by }` in `Contribution.connectors`. `HostOptions.connectorKinds` is a record by name. The fold seeds it from the base, reports a name two plugins take by naming both, keeps the first, and sets the option only when a kind exists. `validate.ts` refuses a missing or non-slug name, a schema that is not an object, capabilities that are not a list of shaped entries, and an `open` that is not a function. 24 `plugin-fold` and 28 `plugin-host` tests pass; `build`, `typecheck` and `boundary` pass.
- **Departures:** `Connector.title` is optional and a client falls back to the id, because a connector is named by its id and the step's list does not say every one has a title. `checkConnectorKind` requires a non-empty `title` and `description` on the kind and on each capability, matching the interface, and only `input` is optional. `plugin-fold.test.ts` gained a fourth case beyond the three named: a kind its contracts do not list is refused, which is step 6's check. `plugin-host.test.ts`'s `Contribution` literals each gained `connectors: {}` for the new required member.
- **Next action:** task 04.
- **Open questions:** none.
- **Watch out for:** a capability is declared and shown; nothing in this plan runs one. The base wins over a plugin's in `connectorKinds`, as it does for channels and ports: a daemon's own kind is not overwritten by a plugin's.
- **Commit:** not made in the session (`git add` is denied here). Files: `packages/sdk/src/types/connectors.ts` (new), `packages/sdk/src/types/index.ts`, `packages/sdk/src/types/plugin.ts`, `packages/sdk/src/types/host.ts`, `packages/sdk/src/plugins/plugins.ts`, `packages/sdk/src/plugins/validate.ts`, `packages/sdk/test/plugin-fold.test.ts`, `packages/sdk/test/plugin-host.test.ts`, this task file and the plan row.
