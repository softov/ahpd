---
title: The tools and providers are configured by cofold's types
status: done
depends: [task-01-ahpd-takes-the-cofold-release.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/capabilities.ts#L16-L172](../../../../packages/agent-cofold/src/capabilities.ts#L16-L172) - the copies, `capabilitiesOf`, `toolsOf` and `searchOf`"
  - "[code://packages/agent-cofold/src/config.ts#L21-L43](../../../../packages/agent-cofold/src/config.ts#L21-L43) - `HarnessProvider` and `HarnessConfig`"
  - "[code://packages/agent-cofold/src/config.ts#L118-L129](../../../../packages/agent-cofold/src/config.ts#L118-L129) - the copy of `splitModel`"
  - "[code://packages/agent-cofold/src/agent.ts#L209](../../../../packages/agent-cofold/src/agent.ts#L209) - a `splitModel` call"
  - "[code://packages/agent-cofold/src/agent.ts#L273](../../../../packages/agent-cofold/src/agent.ts#L273) - a `splitModel` call"
  - "[code://packages/agent-cofold/src/turnagent.ts#L313-L316](../../../../packages/agent-cofold/src/turnagent.ts#L313-L316) - the `capabilitiesOf` call"
  - "[code://packages/agent-cofold/src/plugin.ts#L66-L82](../../../../packages/agent-cofold/src/plugin.ts#L66-L82) - the loose `tools` schema"
  - "[code://packages/agent-cofold/test/agent-cofold-config.test.ts#L74-L77](../../../../packages/agent-cofold/test/agent-cofold-config.test.ts#L74-L77) - the `splitModel` cases"
  - file:///github/cofold/.project/plans/tools/03-the-library-takes-the-config-object/deferred.md - the ahpd row this task closes
---

## Objective

The tool and search configuration, the provider shape and `splitModel` are cofold's.
`standardCapabilities` builds the tools, `Capability.exclude` drops a name a host tool takes, and ahpd chooses `memoryDir`.
`harnessConfig` and `harnessConfigPath` stay, because they read the harness file leniently.

## Files

- `UPDATE: packages/agent-cofold/src/capabilities.ts:16-118` - `SearchConfig`, `ToolsConfig` and `searchProviders` go; `capabilitiesOf` becomes a call to `standardCapabilities(config, { workspace, memoryDir })`, then `exclude` of the host tools' names.
- `UPDATE: packages/agent-cofold/src/capabilities.ts:120-172` - `toolsOf` and `searchOf` stay, for a `tools` option read with `strictTools: false`.
- `UPDATE: packages/agent-cofold/src/config.ts:21-31` - `HarnessProvider` becomes `type HarnessProvider = ProviderConfig`.
- `UPDATE: packages/agent-cofold/src/config.ts:118-129` - the local `splitModel` goes.
- `UPDATE: packages/agent-cofold/src/agent.ts:209` - import `splitModel` from `@cofold/model-openai-compat`.
- `UPDATE: packages/agent-cofold/src/turnagent.ts:313-316` - pass `memoryDir` as `join(storeRoot, 'memory', workspaceSlug({ workspace }))`, and none for a store in memory.
- `UPDATE: packages/agent-cofold/src/plugin.ts:66-82` - the `tools` option is checked against `TOOLS_SCHEMA`, unless the new option `strictTools` is `false`.
- `UPDATE: packages/agent-cofold/package.json` - adds `@cofold/commands` at `^0.3.0`, whose `check` validates the `tools` option.
- `UPDATE: packages/agent-cofold/test/agent-cofold-config.test.ts:74-77` - the `splitModel` cases import cofold's.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts:10-16` - the imports.

## Steps

1. Compare `standardCapabilities` with `capabilitiesOf`, and list any default that differs.
2. Compare cofold's `splitModel` with ahpd's on the cases in the config test.
3. Replace `capabilitiesOf`'s body with `standardCapabilities`, then `exclude`.
4. Delete `withoutTaken` and `searchProviders`.
5. Compute `memoryDir` where the turn knows the store root, as papo does in cofold `packages/papo/src/agent.ts:60`.
6. Replace the type copies with the cofold imports.
7. Delete the local `splitModel`, and import cofold's.
8. Add the boolean option `strictTools` to `plugin.ts`, default `true`, with a one-line description.
9. Check the `tools` option against `TOOLS_SCHEMA` when `strictTools` is not `false`.
10. Read the `tools` option with `toolsOf` when `strictTools` is `false`.

## Validation

- `rg "withoutTaken|searchProviders|function splitModel" packages/agent-cofold/src` finds nothing.
- A session with a host tool named `web_fetch` offers the host tool and not cofold's.
- A session with a store in memory offers no memory tools.
- A misspelled key under `tools` fails at load, and loads with `strictTools: false`.
- `npx vitest run packages/agent-cofold` passes.

## Resume

- `capabilitiesOf` keeps its signature, so `turnagent.ts` changed only where it computes `memoryDir`.
- `standardCapabilities` builds the four capabilities and cofold's own order is the one used.
- `exclude` carries the host tools' names instead of the old `withoutTaken` list.
- A session whose store is in memory passes no `memoryDir`, so cofold leaves memory out.
- `HarnessProvider` is cofold's `ProviderConfig`, and the local `splitModel` is gone.
- `index.ts` re-exports `splitModel` from `@cofold/model-openai-compat` rather than from `config.ts`.
- The `tools` option is checked with `check` from `@cofold/commands` against `TOOLS_SCHEMA`.
- `@cofold/commands` is a new dependency of this package, at the range the plan names.
- The daemon checks the options schema before `apply`, and that check cannot be conditional.
- `optionsSchema.properties.tools` therefore stays loose, which is what lets `strictTools: false` bypass the check.
- The strict check runs inside `optionsOf`, which `strictTools: false` reaches around.
- The README's options table and the options test both gained the `strictTools` row.
- `toolsOf`'s doc now says it is the loose reading that `strictTools: false` asks for.
- The two remaining failures are task 07's read-before-write cases, not this task's.
- `providersOf`, `providerFor` and `PROVIDER_SCHEMA` are not taken; the plan's certification says why.
