---
title: A plugin registers a tunnel kind
status: todo
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L1444-L1454](../../../../packages/sdk/src/types/plugin.ts#L1444-L1454) - `registerAdapter` and `registerEngine`, the declarations `registerTunnelKind` sits beside"
  - "[code://packages/sdk/src/types/connectors.ts#L299-L360](../../../../packages/sdk/src/types/connectors.ts#L299-L360) - `Adapter`, whose name, title, description, schema and icons a kind copies"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1777-L1786](../../../../packages/sdk/src/plugins/plugins.ts#L1777-L1786) - `registerAdapter`, the call to copy"
  - "[code://packages/sdk/src/plugins/plugins.ts#L479-L487](../../../../packages/sdk/src/plugins/plugins.ts#L479-L487) - the fold's refusal of a name another plugin took"
  - "[code://packages/sdk/src/plugins/validate.ts#L718](../../../../packages/sdk/src/plugins/validate.ts#L718) - `checkAdapter`, the check to copy"
  - "[code://packages/sdk/test/plugin-fold.test.ts](../../../../packages/sdk/test/plugin-fold.test.ts) - the fold tests, which the kind tests sit beside"
  - https://github.com/microsoft/agent-host-protocol/blob/ff7d6a1c7b4/types/channels-changeset/state.ts#L259-L298 - `ChangesetOperation`: id, label, icon, scopes and confirmation
---

## Objective

A plugin offers a kind of tunnel with `registerTunnelKind`, as it offers an adapter.
The kind gives a form, the operations it supports and the handlers the host calls.
The operation shape is generic, so the computers can share it later.

## Files

- `CREATE: packages/sdk/src/types/kinds.ts` - `KindOperation`, what a kind declares, and `Operation`, what a channel's state lists.
- `CREATE: packages/sdk/src/types/tunnels.ts` - `TunnelKind`, `Tunnel` and `TunnelReport`.
- `UPDATE: packages/sdk/src/types/plugin.ts:1444-1454` - declare `registerTunnelKind`, and name `tunnelKinds` in the `PluginContracts` comment.
- `UPDATE: packages/sdk/src/plugins/plugins.ts:1777-1797` - the call, checked against `contracts.tunnelKinds`.
- `UPDATE: packages/sdk/src/plugins/plugins.ts:479-487` - fold the kinds and refuse a name another plugin took.
- `UPDATE: packages/sdk/src/plugins/validate.ts:718` - `checkTunnelKind`, beside `checkAdapter`.
- `UPDATE: packages/sdk/src/index.ts` - export the new types and the check.
- `UPDATE: packages/sdk/test/plugin-validate.test.ts` - the kind's checks.
- `UPDATE: packages/sdk/test/plugin-fold.test.ts` - the fold of two kinds and a clash.
- `UPDATE: docs/plugins/PLUGINS.md:544` - "A tunnel kind of your own", after "An adapter of your own".
- `UPDATE: docs/plugins/PLUGINS.md:1372` - `tunnelKinds` in *The contracts*.

## Steps

1. Give `KindOperation` an `id`, and an optional `label`, `description`, `icon`, `input`, `confirmation` and `grant`.
2. Give `Operation` the `KindOperation` fields, with `kind`, `scopes`, `grant`, `status` and an optional `error`.
3. Set `scopes` to `list` for an operation on the list and `tunnel` for one on a record.
4. Give `TunnelKind` a `name`, `title`, `description`, `icons` and `schema`, as `Adapter` has.
5. Give `TunnelKind` an optional `operations` list of `KindOperation`.
6. Give `TunnelKind` the handlers `create(tunnel, report)`, `remove(tunnel)` and `invoke(name, tunnel, report, input?)`.
7. Give `TunnelKind` the optional handlers `update(tunnel, input, report)` and `system(context)`.
8. Make `report` take `{ status?, url?, error? }`, with `status` one of `running`, `stopped` or `error`.
9. Pass `system` a context with the daemon's `port`, and let it answer the create input or nothing.
10. Give `Tunnel` the fields `id`, `kind`, `plugin`, `purpose`, `enabled` and `owner`, and the settings with secrets resolved.
11. In `checkTunnelKind`, copy `checkAdapter` for the name, title, description, icons and schema.
12. Refuse an operation id that is `create`, `update`, `remove`, `enable` or `disable`, because the host owns those.
13. Refuse two operations with one id, and an `input` that is not an object schema.
14. Refuse a `grant` that is not `<word>:<word>`.
15. Require `create`, `remove` and `invoke` as functions, and `update` and `system` as functions when given.
16. Add `registerTunnelKind` to the plugin host, as `registerAdapter` is, with `tunnelKinds` as the contract key.
17. Fold the kinds of every plugin, and refuse a name another plugin took, as for adapters.
18. Keep the plugin's name on the folded kind as `by`.
19. Write the section in `PLUGINS.md` with devtunnel's kind as the example, from the brief's *A kind of tunnel*.

## Validation

- `packages/sdk/test/plugin-validate.test.ts` refuses a kind with no `invoke`, an operation called `create`, and two operations with one id.
- The same file refuses an operation `input` that is not an object schema, and a `grant` with no `:`.
- `packages/sdk/test/plugin-fold.test.ts` folds two kinds of two plugins, and refuses one name from a second plugin with a problem naming both.
- The same file refuses a kind the plugin's `contracts.tunnelKinds` does not list.
- `pnpm --filter @ahpd/sdk test -- plugin-validate` and `pnpm --filter @ahpd/sdk test -- plugin-fold` pass.
- `pnpm typecheck` passes.

## Resume
