---
title: An unregistered grant is reported
status: todo
depends: [task-02-the-host-lists-every-grant-it-uses.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/plugins/plugins.ts#L238-L260](../../../../packages/sdk/src/plugins/plugins.ts#L238-L260) - `FoldedOptions.problems`, one line per problem, and the host is built"
  - "[code://packages/sdk/src/host/root.ts#L534-L575](../../../../packages/sdk/src/host/root.ts#L534-L575) - the grants of channels and methods, as `ahpd.channels` and `ahpd.methods` read them"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1820-L1830](../../../../packages/sdk/src/plugins/plugins.ts#L1820-L1830) - `registerTunnelKind`, whose operations name a grant"
---

## Objective

When the plugins are folded, each grant a channel, a method or a tunnel kind's operation requires is checked against the list.
A grant that no entry lists is one line in `problems`, which names the plugin and the grant, and the plugin loads.

## Files

- `UPDATE: packages/sdk/src/plugins/plugins.ts:310-470` - the check, after the fold.
- `CREATE: packages/sdk/test/plugin-grants-check.test.ts` - listed, unlisted and wildcard grants.

## Steps

1. After the fold, collect the `grant` of each channel, method and tunnel kind operation.
2. Keep with each grant the name of the plugin that added it.
3. Count a grant as listed when its subject has an entry and its operation is `*`, `read` or `write`.
4. Count a grant as listed when its operation is one of its entry's operations.
5. Count `*:*` and `*:<group>` as listed.
6. Take the entries from `OPERATIONS`, the resource schemes and `HostOptions.grants`, as `advertisedGrants` does.
7. Add one line to `problems` for each grant that is not listed: `plugin <name> requires <grant>, which no entry of ahpd.grants lists`.
8. Run the check on the daemon's own channels too, with the name `ahpd`.

## Validation

- `packages/sdk/test/plugin-grants-check.test.ts` holds these cases:
  - a plugin channel requires `notes:read` with no entry, and `problems` holds one line that names the plugin and `notes:read`;
  - the same plugin registers `notes`, and `problems` holds no line;
  - a method requires `session:list`, and `problems` holds no line;
  - a method requires `*:read`, and `problems` holds no line;
  - the plugin loads and its channel answers in every case.
- The daemon at main starts with no such line in its problems.
- `pnpm typecheck` and `pnpm --filter @ahpd/sdk test` pass.

## Resume

