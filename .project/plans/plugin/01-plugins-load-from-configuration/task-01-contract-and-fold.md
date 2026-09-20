---
title: The plugin contract and the fold live in `@ahpd/sdk`
status: todo
depends: []
layer: packages/sdk
refs:
  - code://packages/sdk/src/types/host.ts#L132-L245 - `HostOptions`, whose keys the contract names back
  - code://packages/sdk/src/types/host.ts#L25-L130 - `DirectoryFacts`, `ResourceStore` and `TerminalStore`, three of the ports
  - code://packages/sdk/src/types/host.ts#L247-L306 - `Diagnostics` and `HostTool`, two of the contributions
  - code://packages/sdk/src/types/agent.ts#L158-L292 - `Agent`, the contract `registerAgent` checks against
  - code://packages/sdk/src/types/index.ts - the types barrel a `types/plugin.ts` joins
  - code://packages/sdk/src/index.ts - where the contract and the fold join the exports, beside `createHost` and the ports
  - code://.project/decisions/plugin-contract-lives-in-the-sdk.md - why this is not a package of its own
  - code://.project/decisions/plugin-registration-kinds.md - the closed set of kinds and the `register*` naming this task makes literal
  - code://.project/plans/plugin/00-plugin.md - the table these kinds are the rows of
  - code://test/example.test.ts#L1-L30 - the fake `Agent` the fold test builds a base from
---

## Objective

`@ahpd/sdk` exports the plugin contract as types in `src/types/plugin.ts` and one pure function, `foldHostOptions`, in `src/plugins.ts`, which turns a base `HostOptions` and a list of contributions into one `HostOptions` with appended kinds concatenated and singleton ports refused unless replaced, and a test pins every rule.

## Files

- `CREATE: packages/sdk/src/types/plugin.ts` - `PortKey`, `PortOf`, `PluginSpec`, `Plugin`, `PluginHost`, `Contribution`, `Loaded`.
- `CREATE: packages/sdk/src/plugins.ts` - `foldHostOptions(base, contributions)`.
- `UPDATE: packages/sdk/src/types/index.ts` - re-export `./plugin.js` beside the other type barrels.
- `UPDATE: packages/sdk/src/index.ts` - export `foldHostOptions`, and add one line to the module comment saying a plugin contributes the option object and this composes several.
- `CREATE: test/plugin-fold.test.ts` - the rules below.

The `PluginHost` implementation and the check on what is registered are task 08; this task writes the shape they fill.

## Steps

1. In `src/types/plugin.ts`, declare `PortKey` as the union of the singleton keys of `HostOptions`: `resources`, `terminals`, `changes`, `directories`, `worktrees`, `github`, `automations`, `sessions`, `diagnostics`. It deliberately excludes `agents` and `tools`, which are appended rather than set, so no key can be reached by two operations.
2. Declare `PortOf<K extends PortKey> = NonNullable<HostOptions[K]>`, so `registerResources` demands a `ResourceStore` and not a bag.
3. Declare `PluginSpec = string | { name: string; options?: Record<string, unknown>; enabled?: boolean }`, which is both what `config.json` holds and what `--plugin` produces.
4. Declare `PluginContext` with the read-only `path`, `paths`, `version` and `log`, and `PluginHost extends PluginContext` adding `registerAgent`, `registerTool`, and one method for each `PortKey`: `registerResources`, `registerTerminals`, `registerChanges`, `registerDirectories`, `registerWorktrees`, `registerGithub`, `registerAutomations`, `registerSessions`, `registerDiagnostics`, each taking `PortOf<thatKey>` and an optional `'replace'`. Every method is named `register*`, so a registration is told apart from the host a plugin reads. The doc comment says the surface is `HostOptions` named back (decision 1), that the set of kinds is closed and each registration is checked by task 08 (decision 4), and which kinds are not here yet.
5. Declare `Plugin` with required `name` and `apply(host, options)`, and optional `title` and `defaults`, and say in a comment that a default export is deliberately not consulted, citing the deepseek-harness postmortem the plan refs.
6. Declare `Contribution` as what one `apply` produced: `by` (the plugin's name), `agents`, `tools`, and `ports` as a partial record of `PortKey` to `{ value: unknown; replace: boolean }`. Declare `Loaded` as `{ spec, url, path, name, title?, options, plugin }`.
7. Keep `src/types/plugin.ts` free of runtime imports, so the file is a contract and the barrel rule holds.
8. In `src/plugins.ts`, write `foldHostOptions(base, contributions)` returning `{ options, problems }`: copy the base once, append `agents` and `tools` in contribution order, and for each port either set it or push a problem naming the plugin that set it and the one that claimed it again, unless the later one carries `replace: true`.
9. Treat a plugin port that lands on a base port as a collision with `the daemon`, so a plugin that supplies its own `resources` passes `'replace'` and one that forgets it is told, rather than winning by order.
10. Return a fresh object and fresh arrays, never mutating `base`, and push a problem rather than throwing, so the loader can report every collision at once.
11. Export the types from `src/types/index.ts` and `foldHostOptions` from `src/index.ts`.

## Validation

- `test/plugin-fold.test.ts`, with a base built from a fake `Agent` the way `test/example.test.ts` builds one:
  - contributions from two plugins append their agents and tools in order, and `base.agents` is unchanged afterwards.
  - a contribution whose agent `provider` repeats the base's is reported once, naming the provider and the plugin.
  - two plugins setting `resources` without `replace` produce one problem naming both, and `options.resources` stays the base's.
  - the second plugin with `replace: true` wins, and there is no problem.
  - a plugin setting a port the base does not have, such as `automations`, needs no `replace`.
- `pnpm test` green, `pnpm typecheck` green.
- `pnpm boundary` green and unchanged: the SDK declares no new dependency, because the fold imports only its own types.
- `pnpm build` still builds three packages.

## Resume

Empty until started.
