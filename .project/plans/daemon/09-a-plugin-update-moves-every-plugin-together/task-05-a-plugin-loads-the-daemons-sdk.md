---
title: A plugin loads the daemon's own @ahpd/sdk, and npm installs none beside it
status: dropped
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/plugins.ts](../../../../packages/server/src/plugins.ts) - where a plugin is imported and its peer range checked"
  - "[code://packages/server/src/install.ts](../../../../packages/server/src/install.ts) - the npm calls, and `behind` with the peer-refusal wording"
  - "[code://.project/decisions/a-plugin-loads-the-daemons-sdk.md](../../../decisions/a-plugin-loads-the-daemons-sdk.md) - the decision"
---

## Objective

Every `@ahpd/sdk` import a plugin makes, and any subpath of it, resolves to the daemon's own copy, so one sdk is in memory whatever the configuration directory holds. `plugin install` and `plugin update` run npm with `--legacy-peer-deps`, so npm adds no `@ahpd/sdk` there. `behind` and the peer-refusal wording go.

## Files

- `UPDATE: packages/server/src/plugins.ts` - a Node module resolve hook registered before the first plugin import (`module.registerHooks` is in Node 22.15 and later; the engines say `>=22`).
- `UPDATE: packages/server/src/install.ts` - `--legacy-peer-deps` on install and update; `behind` removed.
- `UPDATE:` the loader and install tests.

## Steps

1. Test first: a fixture plugin in a scratch configuration directory whose own `node_modules/@ahpd/sdk` is a different copy; the plugin's `@ahpd/sdk` import must be the daemon's module (an identity check such as a shared symbol or `sdkVersion()` from the daemon's copy). It fails on current code.
2. Test first: the npm call for install and update carries `--legacy-peer-deps`.
3. Implement. If the resolve hook is not available on the Node the engines allow, or behaves differently under the dev loader (`scripts/dev.mjs`), stop and report the fork instead of choosing another mechanism.

## Validation

- A plugin built for another sdk minor is still refused at load with the loader's sentence.
- On dev86-like state (four plugins, a local `@ahpd/sdk` 0.7.0 in the configuration directory), updating one plugin runs one npm call naming only it.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
Stopped 2026-09-29 before any code, at the fork step 3 names. `module.registerHooks` is not on every runtime this daemon claims: the engines allow Node `>=22`, and Node 22.0 to 22.14 has only `module.register` (off-thread hooks); Bun 1.4.0 has no `registerHooks` (`register` only); Deno 2.9.6 has `registerHooks` and no `register`. The server README says it runs on Bun and Deno. `scripts/dev.mjs` already uses `registerHooks` with a `module.register` fallback for the Node case. Which mechanism covers the runtimes without `registerHooks`, or whether the engines move to `>=22.15` and Bun is dropped or handled separately, is Softov's call.
Implemented 2026-09-29 after Softov chose the mechanism: `registerHooks` where the runtime has it, `register` where it does not, as `scripts/dev.mjs` does. `packages/server/src/sdk-hooks.ts` holds the hooks (`resolveSync` for `registerHooks`; `initialize` and `resolve` for `register`), which resolve `@ahpd/sdk` and any subpath as if the daemon's own `plugins.ts` had imported it. `serveOwnSdk` in `plugins.ts` registers them once, just before the first plugin `import()`. `installPlugins` and `updatePlugins` pass `--legacy-peer-deps`; `behind`, `minorOf` and the peer-refusal wording are gone, with their two tests.
Failing first: `gives a plugin the daemon's own @ahpd/sdk, not the copy beside it` in `test/daemon-backend.test.ts` (a plugin in the configuration directory beside a stale `@ahpd/sdk` that logs its `sdkVersion()`) logged `plugin sdk the stale copy`; the npm argv cases in `test/plugin-install.test.ts` and `test/server-http.test.ts` lacked `--legacy-peer-deps`. All pass after. The incompatible-plugin load test still passes with the loader's sentence.
Runtimes, the same probe by hand: Node 24.19.0 through `registerHooks` and, with `registerHooks` removed, through `register`, from source under `scripts/dev.mjs` and from a build: `plugin sdk 0.8.0` each time. Deno 2.9.6 from a build, the plugin named by path: `plugin sdk 0.8.0` (without the hook Deno cannot resolve `@ahpd/sdk` from there at all). Bun 1.4.0, from source and from a build: `plugin sdk the stale copy`; Bun's `module.register` accepts the hooks and never calls them. With no `@ahpd/sdk` beside the plugin, which `--legacy-peer-deps` now makes the normal case, Bun fails the import (`Cannot find package '@ahpd/sdk'`) while Node answers 0.8.0. Node 22.0 to 22.14 was not run; no such Node is installed.
Open: a plugin on Bun does not get the daemon's sdk, and after an install with `--legacy-peer-deps` it gets none.

Dropped 2026-09-29: [a plugin uses the sdk npm installs beside it](../../../decisions/a-plugin-uses-the-sdk-npm-installs-beside-it.md) replaced the decision it built; task 06 removes its code.
