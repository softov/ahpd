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
  - code://packages/plugin/src/types/plugin.ts - `PluginSpec`, which this task takes as input
  - file:///github/deepseek-harness/packages/boot/plugin-manager/src/install-spec.ts - the spec shapes accepted there: registry range, absolute `file:` path, tarball, git shorthand
  - code://test/update.test.ts#L1-L40 - the temporary `XDG_CONFIG_HOME` pattern the resolver test follows
---

## Objective

`resolvePlugin(spec, { configDir, cwd })` turns any spec a person may write into something importable: a URL with a scheme is passed through, a path is resolved against the working directory and then the configuration directory, and a bare name is resolved through the configuration directory's own `node_modules`, with a Deno that has no `createRequire` answering a plain error that says to write `npm:`.

## Files

- `CREATE: packages/server/src/plugins.ts` - `resolvePlugin` and the `Resolved` shape it returns.
- `UPDATE: packages/server/package.json:45-48` - declare `"@ahpd/plugin": "workspace:^"` beside `@ahpd/sdk`, because the boundary check reads declarations and not resolutions.
- `UPDATE: packages/sdk/src/listen.ts:15-L19` - export `runtimeOf` as `runtime`, with a comment saying the knowledge stays in this module rather than moving to a second detector.
- `UPDATE: packages/sdk/src/index.ts` - export `runtime` beside `listen`.
- `CREATE: test/plugin-resolve.test.ts` - the cases below.

## Steps

1. Export the existing `runtimeOf` from `packages/sdk/src/listen.ts` as `runtime`, keeping the comment that this module is the only one that knows which runtime it is on, and re-export it from `packages/sdk/src/index.ts`.
2. In `packages/server/src/plugins.ts`, define `Resolved` as `{ spec: PluginSpec; url: string; path?: string }`, where `path` is present only when the URL is a `file:` URL, because that is what a manifest is looked up from.
3. Write `hasScheme(spec)` as `/^[a-zA-Z][a-zA-Z0-9+.-]*:/`, and return the spec unchanged when it matches, so `file:`, `npm:`, `jsr:`, `https:` and `data:` are the writer's decision and not the daemon's.
4. For an absolute spec or one starting with `.`, resolve it against `cwd` first and then `configDir`, and refuse with a message naming both places tried when neither is there, because a relative path means the working directory decides what runs.
5. For a bare spec, refuse with a message that says to write `npm:<name>` when `runtime()` is `deno`, since Deno has no `createRequire`.
6. Otherwise resolve it with `createRequire(join(configDir, 'package.json')).resolve(spec)` and convert with `pathToFileURL().href`, which is what makes `npm i` in the configuration directory the install, as `ideas/agents-as-extensions.md` decided.
7. Wrap the `createRequire` call so a spec that is not installed becomes a message naming the spec and the directory it was looked for in, rather than a resolved `MODULE_NOT_FOUND` stack.
8. Keep the function synchronous and free of the network, so a listing and a load agree on what a spec means.

## Validation

- `test/plugin-resolve.test.ts`, with `XDG_CONFIG_HOME` in a temporary directory holding `ahpd/package.json` and `ahpd/node_modules/fixture-plugin/`:
  - `resolvePlugin('fixture-plugin', { configDir, cwd })` returns a `file:` URL inside that `node_modules` and a `path` equal to the same file.
  - `resolvePlugin('./missing.js', …)` refuses with a message naming the working directory and the configuration directory.
  - `resolvePlugin('npm:fixture-plugin', …)` returns the spec unchanged, with no `path`.
  - `resolvePlugin('@scope/missing', …)` refuses with a message naming the spec, not a raw Node error.
  - On Node and Bun the bare spec resolves; the Deno branch is checked by calling the message builder directly, since the suite runs on Node.
- `pnpm test` green, `pnpm typecheck` green, `pnpm boundary` green with `@ahpd/server` declaring `@ahpd/plugin`.

## Resume

Empty until started.
