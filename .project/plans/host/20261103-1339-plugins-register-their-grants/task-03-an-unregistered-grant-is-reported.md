---
title: An unregistered grant is reported
status: implemented
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

- Built: after the fold, `foldHostOptions` collects the grant of every served channel, method and tunnel kind operation, keeps the `by` beside each, and pushes one `problems` line per grant `grantEntries` does not list. The plugin still loads and serves.
- A grant is listed when its subject has an entry and the operation is one of its operations or a group (`read`/`write`) of it, and `*:*`, `*:read` and `*:write` are always listed. The entries are the ones `ahpd.grants` carries: the table, the resource schemes and the registered grants.
- The plan did not know the daemon serves `x-ahpd/invokeOperation` with `operation:invoke`, which nothing listed. `run.ts` now registers `operation` with `invoke` beside `client` and `tunnel`, and `docs/sdk/USERS.md` has its row (the subject count is nineteen). `grants-advertised.test.ts` asserts the entry.
- Existing tests that used unlisted grants were pointed at listed ones: `host-methods.test.ts` (`session:list`), `plugin-validate.test.ts` (`session:read` and `session:list`), and `plugin-channel.test.ts` (`demo` registered) and `plugin-method.test.ts` (`session:list`) in the earlier edit.
- Gates: `pnpm build`, `pnpm exec tsc -p tsconfig.json --noEmit`, `pnpm boundary`, and the sdk, server and bot suites pass.
- The daemon at main starts with no such line: `server-cli-start.test.ts` and `grants-advertised.test.ts` both pass.
