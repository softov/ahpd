---
title: The package exists, registers provider `cofold`, and carries its model config
status: done
depends: []
layer: packages/agent-cofold
refs:
  - code://packages/sdk/src/types/agent.ts#L146-L300 - `Agent`, the contract this package implements
  - code://packages/sdk/src/types/agent.ts#L66-L140 - `Start`, what `create` is handed
  - code://packages/sdk/src/types/plugin.ts - `PluginHost` and `PluginContext`, what the entry is handed
  - code://packages/server/src/plugins.ts - the loader that installs this package by spec
  - file:///github/cofold/packages/agents/src/index.ts - `createAgent`, the harness this wraps
  - file:///github/cofold/packages/agents/src/types/agent.ts - `AgentOptions`, what a facio agent is built from
  - file:///github/cofold/packages/model-openai-compat/src/index.ts - `openaiCompat`, the model adapter the config selects
  - file:///github/cofold/packages/store-file/src/index.ts - `createFileStore`, the durable store
  - code://test/plugin-load.test.ts - the manifest and peer-range shape a plugin package already has
---

## Objective

`packages/agent-cofold` is a workspace package exporting `facioAgent(options): Agent`, whose `provider` is `facio` by default, whose `schema()` and `defaults()` carry the model and endpoint a session runs on, and whose `create` is the session task 02 fills; the package declares `@facio/agents` and its model adapter, and the root checker and runner know the new package.

## Files

- `CREATE: packages/agent-cofold/package.json` - the name, the exports, `peerDependencies: { "@ahpd/sdk": "^0.6" }`, and the facio dependencies.
- `CREATE: packages/agent-cofold/tsconfig.json` - the package build, the way the three existing ones are written.
- `CREATE: packages/agent-cofold/src/index.ts` - what the package exports: `facioAgent` and the option type.
- `CREATE: packages/agent-cofold/src/agent.ts` - `facioAgent(options): Agent`, the schema, the defaults and the model factory.
- `UPDATE: tsconfig.json` and `vitest.config.ts` - the `@ahpd/agent-cofold` alias, so the checker and the runner both read source.
- `UPDATE: package.json` - the root `build` script gains the fourth package, so `pnpm build` still builds everything.
- `CREATE: test/agent-cofold.test.ts` - the cases below.

## Steps

1. Write the manifest: `@ahpd/agent-cofold`, `type: "module"`, `exports` with a types-and-default entry, `peerDependencies` naming `@ahpd/sdk` so the loader's compatibility check has a range to read, and `dependencies` on `@facio/agents`, `@facio/model-openai-compat` and `@facio/store-file`, linked until facio publishes.
2. Write the package tsconfig, add the alias to the root `tsconfig.json` paths and `vitest.config.ts`, and add the package to the root `build` script, so a test imports `@ahpd/agent-cofold` the way an embedder does and `pnpm build` still builds every package.
3. In `agent.ts`, write `facioAgent(options)` returning an `Agent` whose `provider` is `options.provider ?? 'facio'` and whose `displayName` is `options.displayName ?? 'Facio'`.
4. Write `schema()` as the session settings the provider takes: the model id, the base URL, an API key, and the instructions, each with a title and a description, and `sessionMutable: true` for the ones a running session may change.
5. Write `defaults()` returning the model the package ships a default for, so a client that chooses nothing still has a runnable session, and refuse at `create` when no model was chosen and no default exists.
6. Write the model factory the schema feeds: `openaiCompat({ baseUrl, apiKey, model })` from `@facio/model-openai-compat`, built per session so two sessions can point at two endpoints, and a seam where a caller may pass its own model adapter for a test.
7. Write the store: `createFileStore` at `options.store` when the plugin named a path, and otherwise a path derived from the environment the way `packages/server/src/config.ts` derives its own, because `PluginContext` carries the served directories and not the configuration directory.
8. Leave `create` returning the session task 02 writes, `list` and `transcript` for task 04, and `probe` returning the configured models with no commands, so this task is testable on its own.

## Validation

- `test/agent-cofold.test.ts`, over the agent and never over a network:
  - `facioAgent({})` answers `provider: 'facio'` and a `schema()` whose keys include the model and the base URL.
  - `defaults()` and `schema()` agree: every default key is a key the schema declares.
  - a second agent built with `provider: 'other'` does not collide with the first.
  - the model factory returns an adapter whose `id` carries the model id, and a caller-passed adapter is used instead when one is given.
- `pnpm test` green, `pnpm typecheck` green, `pnpm boundary` green with the new package declaring facio.
- `pnpm build` builds four packages.

## Resume

Done 2026-09-20.
`packages/agent-cofold` holds `package.json`, `tsconfig.json`, `src/agent.ts` and `src/index.ts`; `facioAgent(options)` answers provider `facio` by default, the schema carries `model`, `baseUrl`, `apiKey` and `instructions`, `defaults()` names only what the package was given, `modelOf` builds an `openaiCompat` adapter or returns a caller's, `storeOf` builds the file store at `options.store` or under `XDG_DATA_HOME` and a memory store for a test, and `probe()` offers the configured model with no commands.
The root `tsconfig.json` paths, `vitest.config.ts` alias and `package.json` `build` script name the package, and the root `devDependencies` carry the same three `link:` deps so a test under `test/` can import a facio type.
`test/agent-cofold.test.ts` covers the provider and the schema keys, a second registration's provider, the defaults agreeing with the schema, the model factory and the caller's adapter, the refusal when no model was chosen, and the store.
Verified: `pnpm test` 739 passed over 49 files, `pnpm typecheck` green, `pnpm boundary` green with `@ahpd/agent-cofold: 4 declared, none undeclared`, `pnpm build` builds four packages.
Facio is linked rather than published: `/github/cofold/packages/agents`, `model-openai-compat` and `store-file` are built with `node node_modules/typescript/bin/tsc -p` in the facio checkout, because `pnpm build` there cannot open its store under the sandbox; the ahpd installs that wrote the link symlinks and `pnpm-lock.yaml` did so with wider access for the same reason.
Departures from the plan: the package is `private: true` until facio publishes, since a `link:` dependency cannot be published; `create` throws saying the session arrives in task 02, so a client cannot mistake an unbuilt backend for a model that said nothing; the root `devDependencies` carry the facio links as well as the package's own, because the package-local links are not visible to a test file at the repository root.
