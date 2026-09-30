---
title: A plugin keeps the sdk npm installs, and nothing depends on it being the daemon's
status: implemented
depends: []
layer: "server, sdk, computer"
refs:
  - "[code://packages/server/src/sdk-hooks.ts](../../../../packages/server/src/sdk-hooks.ts) - the resolve hook task 05 added, to remove"
  - "[code://packages/server/src/plugins.ts](../../../../packages/server/src/plugins.ts) - `serveOwnSdk`, to remove"
  - "[code://packages/server/src/install.ts](../../../../packages/server/src/install.ts) - `--legacy-peer-deps` to remove; `behind` and the peer-refusal wording to restore"
  - "[code://packages/sdk/src/rpc.ts#L209-L217](../../../../packages/sdk/src/rpc.ts#L209-L217) - `instanceof RpcError`"
  - "[code://packages/computer/src/devcontainer.ts#L415](../../../../packages/computer/src/devcontainer.ts#L415) - `sdkVersion()`"
  - "[code://packages/sdk/src/types/plugin.ts#L83-L84](../../../../packages/sdk/src/types/plugin.ts#L83-L84) - `PluginContext.version`"
---

## Objective

Task 05 is undone: no resolve hook, no `sdk-hooks.ts`, and npm runs without `--legacy-peer-deps`, so it installs the peer `@ahpd/sdk` beside the plugins again.
Task 02's peer refusal comes back: an install npm refuses because an installed `@ahpd/*` plugin peers an older sdk names that plugin and its version, and says to run `ahpd plugin update all`.
Nothing depends on a plugin's sdk being the daemon's copy: the JSON-RPC error path takes the code from an error named `RpcError` with a numeric `code`, whichever copy made it, and an `execFile` error's numeric exit code stays -32603, and the computer plugin pins the server it installs in a container to `PluginContext.version`.

## Steps

1. Failing first: an error from a second copy of `RpcError` (a class with the same shape, not the same identity) keeps its code and `data` on the wire; the computer plugin's install line uses the context's version; an install refused for a peer names the blocker.
2. Remove the hook and the flag, restore `behind` and its wording and their tests.
3. The same stale-copy probe by hand on Node, Bun and Deno: a plugin loads and answers with the copy beside it.

## Validation

- `pnpm typecheck`, `pnpm boundary`, full `pnpm test` 3 times.

## Resume

Implemented 2026-09-29, in the `fixes-0-8-1` worktree.
- The resolve hook is gone: `packages/server/src/sdk-hooks.ts` is deleted and `plugins.ts` is back as it was, with no `serveOwnSdk`. `installPlugins` and `updatePlugins` run npm without `--legacy-peer-deps`; the daemon-backend case for the daemon's own sdk is removed.
- Task 02's peer refusal is back in `install.ts` (`minorOf`, `behind`, the ERESOLVE branch), now saying `Run ahpd plugin update all to move every plugin to <version>.`, with its unit case in `test/plugin-install.test.ts` and its CLI case in `test/server-cli.test.ts`. Both failed first (no blocker named) and pass after. `NpmFailure` and the terminal/HTTP split are unchanged.
- `receive` in `packages/sdk/src/rpc.ts` takes the JSON-RPC code and `data` from any error whose `code` is a number (`rpcShaped`), not `instanceof RpcError`. Failing first: `keeps the code and data of an error shaped like RpcError from another copy of the sdk` in `test/rpc.test.ts` got -32603 and no `data`. `answers a Node error whose code is a string as an internal error` guards ENOENT and passed before and after. `resources.ts:351` keeps its `instanceof`: it only sees errors thrown by its own module in the same copy, never a plugin's.
- `devContainer` in `packages/computer/src/devcontainer.ts` takes `version` and pins `npm i -g @ahpd/server@<version>` to it; `plugin.ts` passes `host.version` (`PluginContext.version`); with no version the published latest is installed. `sdkVersion` is no longer imported there. Failing first: `pins the host it installs to the version it was given` (`test/devcontainer.test.ts`) and `installs the server in a container at the daemon's version, from the plugin's context` (`test/computer-devcontainer.test.ts`, loaded with `version: '0.8.77'`) both saw `@ahpd/server@0.8.0`. The existing install case now expects the unpinned line when no version is given.
- By hand, a plugin in a scratch configuration directory beside an `@ahpd/sdk` copy whose `sdkVersion()` answers 'the stale copy' loads and answers `plugin sdk the stale copy` on Node 24.19.0 (source and build), Bun 1.4.0 (source and build) and Deno 2.9.6 (build, the plugin named by path).
- Reopened on review and implemented again 2026-09-29: `rpcShaped` also requires `name === 'RpcError'`, so an `execFile` failure's numeric exit `code` goes out as -32603; failing first, `answers an error whose code is a number but is no RpcError, as an execFile failure is, as an internal error` in `test/rpc.test.ts` got 128.
