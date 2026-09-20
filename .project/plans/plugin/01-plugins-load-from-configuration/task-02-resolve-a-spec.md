---
title: A spec becomes an importable URL, on all three runtimes
status: todo
depends:
  - task-01-contract-and-fold.md
layer: packages/server
refs:
  - code://packages/server/src/config.ts#L50-L57 - `configDir()`, the directory a bare spec resolves from
  - code://packages/server/src/version.ts#L20-L37 - `manifest()`, the nearest-manifest walk the reader in task 03 mirrors
  - code://packages/sdk/src/listen.ts#L15-L19 - `runtimeOf()`, the one place the runtime is known, which this task exports rather than copies
  - code://packages/sdk/src/index.ts - where the exported runtime joins the SDK's surface
  - code://packages/sdk/src/types/plugin.ts - `PluginSpec`, which this task takes as input
  - code://.project/decisions/plugin-manifest-is-package-json.md - the `ahpd.entry` a directory spec resolves through
  - code://.project/decisions/plugin-compat-is-checked-before-import.md - why a directory resolves through its manifest at all
  - file:///github/deepseek-harness/packages/boot/plugin-manager/src/install-spec.ts - the spec shapes accepted there: registry range, absolute `file:` path, tarball, git shorthand
  - code://test/update.test.ts#L1-L40 - the temporary `XDG_CONFIG_HOME` pattern the resolver test follows
---

## Objective

`resolvePlugin(spec, { configDir, cwd })` turns any spec a person may write into something importable: a URL with a scheme is passed through, a path is resolved against the working directory and then the configuration directory, a path that is a directory resolves through its own manifest, and a bare name is resolved through the configuration directory's own `node_modules`, with a Deno that has no `createRequire` answering a plain error that says to write `npm:`.

## Files

- `CREATE: packages/server/src/plugins.ts` - `resolvePlugin`, `entryOf` and the `Resolved` shape they return.
- `UPDATE: packages/sdk/src/listen.ts:15-L19` - export `runtimeOf` as `runtime`, with a comment saying the knowledge stays in this module rather than moving to a second detector.
- `UPDATE: packages/sdk/src/index.ts` - export `runtime` beside `listen`.
- `CREATE: test/plugin-resolve.test.ts` - the cases below.

## Steps

1. Export the existing `runtimeOf` from `packages/sdk/src/listen.ts` as `runtime`, keeping the comment that this module is the only one that knows which runtime it is on, and re-export it from `packages/sdk/src/index.ts`.
2. In `packages/server/src/plugins.ts`, define `Resolved` as `{ spec: PluginSpec; url: string; path: string; packageDir?: string }`, where `path` is the file to import and `packageDir` is present when a manifest was read to find it, because that is what task 03 validates.
3. Write `hasScheme(spec)` as `/^[a-zA-Z][a-zA-Z0-9+.-]*:/`, and return the spec unchanged when it matches, so `file:`, `npm:`, `jsr:`, `https:` and `data:` are the writer's decision and not the daemon's.
4. For an absolute spec or one starting with `.`, resolve it against `cwd` first and then `configDir`, and refuse with a message naming both places tried when neither is there, because a relative path means the working directory decides what runs.
5. Write `entryOf(dir)`: read `dir/package.json`, and take the entry in the order `ahpd.entry`, `exports["."]` as a string or its `default`, `main`, `index.js`; resolve it against `dir` and refuse an entry that escapes `dir`, or a directory where none of the four is there, naming the directory and what was looked for.
6. When the resolved path is a directory, set `packageDir` and run `entryOf`; when it is a file, leave `packageDir` undefined and let task 03 find the manifest by walking up.
7. For a bare spec, refuse with a message that says to write `npm:<name>` when `runtime()` is `deno`, since Deno has no `createRequire`.
8. Otherwise resolve it with `createRequire(join(configDir, 'package.json')).resolve(spec)` and convert with `pathToFileURL().href`, which is what makes `npm i` in the configuration directory the install, as `ideas/agents-as-extensions.md` decided.
9. Set `packageDir` by walking up from the resolved file to the nearest `package.json`, the way `version.ts` does, so an installed package is validated by the same rule as a path.
10. Wrap the `createRequire` call so a spec that is not installed becomes a message naming the spec and the directory it was looked for in, rather than a resolved `MODULE_NOT_FOUND` stack.
11. Keep the function free of the network and free of `import()`, so a listing and a load agree on what a spec means and neither runs a plugin.

## Validation

- `test/plugin-resolve.test.ts`, with `XDG_CONFIG_HOME` in a temporary directory holding `ahpd/package.json` and `ahpd/node_modules/fixture-plugin/`:
  - `resolvePlugin('fixture-plugin', { configDir, cwd })` returns a `file:` URL inside that `node_modules`, a `path` equal to the same file, and a `packageDir`.
  - `resolvePlugin('./missing.js', …)` refuses with a message naming the working directory and the configuration directory.
  - `resolvePlugin('npm:fixture-plugin', …)` returns the spec unchanged, with no `path` and no `packageDir`.
  - `resolvePlugin('@scope/missing', …)` refuses with a message naming the spec, not a raw Node error.
  - a directory fixture with `{"ahpd":{"entry":"./main.js"}}` resolves to `main.js`; without the key but with `"main"`, to `main`; with only `index.js`, to `index.js`; with none of them, refused naming the directory.
  - a fixture whose `ahpd.entry` is `"../outside.js"` is refused, so a manifest cannot point outside its package.
  - On Node and Bun the bare spec resolves; the Deno branch is checked by calling the message builder directly, since the suite runs on Node.
- `pnpm test` green, `pnpm typecheck` green, `pnpm boundary` green and unchanged, because the resolver imports `@ahpd/sdk`, which `@ahpd/server` already declares.

## Resume

Empty until started.
