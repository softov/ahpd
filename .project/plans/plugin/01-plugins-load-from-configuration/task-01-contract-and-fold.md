---
title: The plugin contract and the fold exist as `@ahpd/plugin`
status: todo
depends: []
layer: packages/plugin
refs:
  - code://packages/sdk/src/types/host.ts#L132-L245 - `HostOptions`, whose keys the contract names back
  - code://packages/sdk/src/types/host.ts#L247-L306 - `Diagnostics` and `HostTool`, two of the contributions
  - code://packages/sdk/src/types/agent.ts#L158-L292 - `Agent`, the contribution a harness plugin makes
  - code://packages/sdk/package.json#L33-L47 - the `exports`, `files` and `engines` shape a sibling package copies
  - code://packages/sdk/tsconfig.json - the one-line package tsconfig to mirror
  - code://packages/sdk/src/index.ts - what the contract re-exports types from
  - code://.project/decisions/plugin-contributes-host-options.md - the decisions this task makes literal
  - code://tsconfig.json#L5-L10 - the checker aliases that gain `@ahpd/plugin`
  - code://vitest.config.ts#L15-L17 - the runner aliases that have to agree
  - code://package.json#L15 - the root `build` script, which names every package and gains one
---

## Objective

`packages/plugin` is a workspace package named `@ahpd/plugin` that exports the plugin contract as types and one pure function, `foldHostOptions`, which turns a base `HostOptions` and a list of contributions into one `HostOptions` with additive keys concatenated and singleton ports refused unless replaced, and a test pins every rule.

## Files

- `CREATE: packages/plugin/package.json` - the package, its `exports` with a `development` condition, and `@ahpd/sdk` as its one dependency.
- `CREATE: packages/plugin/tsconfig.json` - extends `../../tsconfig.base.json`, `outDir: dist`, `rootDir: src`.
- `CREATE: packages/plugin/src/types/plugin.ts` - `PortKey`, `PortOf`, `PluginSpec`, `Plugin`, `PluginHost`, `Contribution`, `Loaded`.
- `CREATE: packages/plugin/src/fold.ts` - `foldHostOptions(base, contributions)`.
- `CREATE: packages/plugin/src/index.ts` - re-exports the types and the fold.
- `CREATE: packages/plugin/README.md` - what a plugin is, in the length `packages/sdk/README.md` sets.
- `CREATE: packages/plugin/LICENSE` - copied from a sibling package.
- `UPDATE: tsconfig.json:5-10` - add `"@ahpd/plugin": ["packages/plugin/src/index.ts"]` beside the two entries there.
- `UPDATE: vitest.config.ts:15-17` - add the same alias to the runner, or a test reads `dist` and passes against the last build.
- `UPDATE: package.json:15` - add `tsc -p packages/plugin` to the `build` script beside the other three.
- `CREATE: test/plugin-fold.test.ts` - the rules below.

## Steps

1. Write `package.json` with `name: "@ahpd/plugin"`, the version the other packages carry, `type: "module"`, `exports` shaped like `packages/sdk/package.json` with `types`, `development` and `default`, `files: ["dist", "src", "README.md"]`, `engines: { node: ">=22" }`, `dependencies: { "@ahpd/sdk": "workspace:^" }`, `publishConfig.access: "public"` and `scripts.prepack: "tsc -p ."`.
2. In `src/types/plugin.ts`, declare `PortKey` as the union of the singleton keys of `HostOptions`: `resources`, `terminals`, `changes`, `directories`, `worktrees`, `github`, `automations`, `sessions`, `diagnostics`.
3. Declare `PortOf<K extends PortKey> = NonNullable<HostOptions[K]>`, so `port('resources', …)` demands a `ResourceStore` and not a bag.
4. Declare `PluginSpec = string | { name: string; options?: Record<string, unknown>; enabled?: boolean }`, which is both what `config.json` holds and what `--plugin` produces.
5. Declare `PluginHost` with `agent`, `agents`, `tool`, `tools`, `port<K>(key, value, when?)` where `when` is the literal `'replace'`, and the read-only `path`, `paths`, `version`, `log`. Add a doc comment saying the surface is `HostOptions` named back, citing decision 1.
6. Declare `Plugin` with required `name` and `apply(host, options)`, and optional `title` and `defaults`, and say in a comment that a default export is deliberately not consulted, citing the deepseek-harness postmortem the plan refs.
7. Declare `Contribution` as what one `apply` produced: `by` (the plugin's name), `agents`, `tools`, and `ports` as a partial record of `PortKey` to `{ value: unknown; replace: boolean }`. Declare `Loaded` as `{ spec, url, path, name, title?, options, plugin }`.
8. In `src/fold.ts`, write `foldHostOptions(base: HostOptions, contributions: Contribution[]): { options: HostOptions; problems: string[] }`. It copies the base once, appends `agents` and `tools` in contribution order, and for each port either sets it or pushes a problem naming both the plugin that set it and the one that claimed it again, unless the later one carries `replace: true`.
9. Treat a plugin port that lands on a base port as a collision with `the daemon`, so a plugin that supplies its own `resources` passes `'replace'` and one that forgets it is told, rather than winning by order.
10. Return a fresh object and fresh arrays, never mutating `base`, and push a problem rather than throwing, so the loader can report every collision at once.
11. Export everything from `src/index.ts`, the types from `./types/plugin.js` and the function from `./fold.js`.
12. Add the alias to `tsconfig.json` and `vitest.config.ts`, add the build line, and write `test/plugin-fold.test.ts`.

## Validation

- `test/plugin-fold.test.ts`, with a base built from a fake `Agent` the way `test/example.test.ts` builds one:
  - two contributions append their agents and tools in order, and `base.agents` is unchanged afterwards.
  - a contribution whose agent `provider` repeats the base's is reported once, naming the provider and the plugin.
  - two plugins setting `resources` without `replace` produce one problem naming both, and `options.resources` stays the base's.
  - the second plugin with `replace: true` wins, and there is no problem.
  - a plugin setting a port the base does not have, such as `automations`, needs no `replace`.
- `pnpm boundary` green, with `@ahpd/plugin: 1 declared, none undeclared`.
- `pnpm build` builds four packages and `pnpm typecheck` is green.

## Resume

Empty until started.
