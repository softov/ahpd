---
title: One install path takes every source
status: done
depends: []
layer: "server, docs"
refs:
  - "[code://packages/server/src/install.ts#L622-L657](../../../../packages/server/src/install.ts#L622-L657) - `installPlugins`, which refuses a source that is not a package name"
  - "[code://packages/server/src/install.ts#L178](../../../../packages/server/src/install.ts#L178) - `isPackageName`"
  - "[code://packages/server/src/commands/plugin.ts#L220-L275](../../../../packages/server/src/commands/plugin.ts#L220-L275) - the CLI action that calls it"
  - "[code://packages/server/test/plugin-install.test.ts](../../../../packages/server/test/plugin-install.test.ts) - the tests with a fake npm runner"
---

## Objective

`installPlugins` takes an npm package name, `github:<owner>/<repo>`, a `git+ssh:` URL, an `https:` tarball URL or a path.
npm installs each one into the plugin root, and the `plugins` list gets the name that npm wrote.
`ahpd plugin install` takes every source with no other change.

## Files

- `UPDATE: packages/server/src/install.ts:622-657` - take every source, read the new dependency name from the plugin root's `package.json`, and refuse a package with no `ahpd` field.
- `UPDATE: packages/server/src/commands/plugin.ts:220-275` - say in the `name` field that it takes every source.
- `UPDATE: packages/server/test/plugin-install.test.ts` - the cases below.
- `UPDATE: docs/plugins/PLUGINS.md` - the sources `ahpd plugin install` takes, and that npm runs no build script for a git source.

## Steps

1. Keep the registry check for a package name, as it is.
2. Pass a source that is not a package name to npm as written.
3. Read the plugin root's `package.json` before and after npm runs.
4. Take the dependency that npm added as the plugin's name.
5. Read that package's `package.json`, and check that it has an `ahpd` field.
6. Run `npm uninstall` for it and refuse it when it has no `ahpd` field.
7. Write the name into the `plugins` list.
8. Run `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`, then restore `packages/sdk/test/fixtures/wire.jsonl`.

## Validation

- A test installs `github:owner/repo` with a fake npm that adds `demo` to `package.json`, and `config.json` names `demo`.
- A test installs a path and a tarball URL the same way.
- A test refuses a source whose package has no `ahpd` field, and the fake npm saw `uninstall demo`.
- A test shows that a package name still goes through the registry check first.
- The gate passes.
