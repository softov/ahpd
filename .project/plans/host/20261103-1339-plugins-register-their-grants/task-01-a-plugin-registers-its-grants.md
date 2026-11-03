---
title: A plugin registers its grants
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L1186](../../../../packages/sdk/src/types/plugin.ts#L1186) - `registerResourceProvider`, the call to sit beside"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1506-L1520](../../../../packages/sdk/src/plugins/plugins.ts#L1506-L1520) - how a plugin's host records a registration"
  - "[code://packages/sdk/src/plugins/plugins.ts#L310-L470](../../../../packages/sdk/src/plugins/plugins.ts#L310-L470) - `foldHostOptions`, where `resourceProviders` are folded"
  - "[code://packages/sdk/src/plugins/validate.ts#L310-L400](../../../../packages/sdk/src/plugins/validate.ts#L310-L400) - the registration checks"
  - "[code://packages/sdk/src/host/root.ts#L575-L628](../../../../packages/sdk/src/host/root.ts#L575-L628) - `schemeGrants` and `advertisedGrants`"
  - "[code://packages/sdk/src/access/users.ts#L265](../../../../packages/sdk/src/access/users.ts#L265) - `operationsOf`, where a subject's groups come from"
---

## Objective

A plugin calls `host.registerGrants(subject, { title?, description?, operations })`, and the subject is on `ahpd.grants` with those operations.
A registration never changes what the access check answers.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:1186` - `registerGrants` and its entry type, beside `registerResourceProvider`.
- `UPDATE: packages/sdk/src/types/host.ts` - `HostOptions.grants`, the registered entries by subject.
- `UPDATE: packages/sdk/src/plugins/plugins.ts:1506-1520` - the plugin's host records each registration as a contribution.
- `UPDATE: packages/sdk/src/plugins/plugins.ts:310-470` - `foldHostOptions` merges the entries into `HostOptions.grants`.
- `UPDATE: packages/sdk/src/plugins/validate.ts:310-400` - the registration's subject and operation words are checked.
- `UPDATE: packages/sdk/src/host/root.ts:575-628` - `advertisedGrants` adds the registered entries.
- `CREATE: packages/sdk/test/plugin-grants.test.ts` - registration, merge, groups and refusals.
- `UPDATE: docs/plugins/PLUGINS.md:440-470` - how a plugin registers its grants.

## Steps

1. Add `GrantEntry` with `title?`, `description?` and `operations`, and `registerGrants(subject, entry)` on the plugin host type.
2. Add `grants?: Record<string, GrantEntry>` to `HostOptions`, with a comment that says a registration gives nothing to anyone.
3. Record each `registerGrants` call as a contribution, as `registerResourceProvider` records a provider.
4. Refuse a subject or an operation word that `grantProblem` would refuse, with the `miss` sentence.
5. Refuse the operation words `read`, `write` and `*`, because these are groups and the wildcard.
6. In `foldHostOptions`, merge the entries by subject: join the operations, and keep the first title and description.
7. Add a problem line for an operation on a subject of `OPERATIONS` that the table lacks, and drop that operation.
8. In `advertisedGrants`, join each registered subject that `OPERATIONS` lacks with its resource scheme entry, where one exists.
9. Take each joined subject's groups from `operationsOf(subject)`, filtered to its operations.
10. Keep the resource provider's title and description first, then the registered ones, then the subject itself.
11. Write the docs section in `PLUGINS.md`.

## Validation

- `packages/sdk/test/plugin-grants.test.ts` holds these cases:
  - a plugin registers `notes` with `pin` and `put`, and `ahpd.grants` holds `notes` with both, and `put` in `write`;
  - `pin` is in neither group, and a role holding `notes:write` does not hold `notes:pin`;
  - two plugins register `notes`, and the list holds one entry with the operations of both and the first title;
  - a registration of `session` with `export` adds a problem line, and `session` keeps its table operations;
  - the host refuses `registerGrants` with the operation `read` or a subject with a space.
- `pnpm typecheck` and `pnpm --filter @ahpd/sdk test` pass.

## Resume

- Built: `registerGrants` records a contribution, `foldHostOptions` merges it into `HostOptions.grants`, and `grantEntries` in `root.ts` lists it on `ahpd.grants` with groups from `operationsOf`. `packages/sdk/test/plugin-grants.test.ts` covers registration, the merge, the groups, the dropped table operation and the refusals.
- Gates: `pnpm build`, `pnpm exec tsc -p tsconfig.json --noEmit`, `pnpm boundary` and `pnpm --filter @ahpd/sdk test` pass.
- The merged entry keeps the first title and the first description that were written, so a second plugin's description stands when the first wrote none.

