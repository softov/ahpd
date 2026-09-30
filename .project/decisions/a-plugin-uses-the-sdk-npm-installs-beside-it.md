---
title: A plugin uses the @ahpd/sdk npm installs beside it, and nothing depends on it being the daemon's copy
status: superseded
superseded-by: decisions/the-daemon-installs-its-own-sdk-beside-the-plugins.md
date: 2026-09-29
supersedes: decisions/a-plugin-loads-the-daemons-sdk.md
refs:
  - "[code://packages/sdk/src/rpc.ts#L209](../../packages/sdk/src/rpc.ts#L209) - `instanceof RpcError`, which a second copy's error fails"
  - "[code://packages/computer/src/devcontainer.ts#L415](../../packages/computer/src/devcontainer.ts#L415) - `sdkVersion()`, which answers the copy's version"
  - "[code://packages/sdk/src/types/plugin.ts#L83-L84](../../packages/sdk/src/types/plugin.ts#L83-L84) - `PluginContext.version`, the daemon's sdk version"
  - "[code://packages/server/src/install.ts](../../packages/server/src/install.ts) - `npm install --prefix <config dir>`"
---

## Context

A plugin takes only a few small runtime values from `@ahpd/sdk` (`Status`, `idOf`, `idFor`, `tail`, `machineAsked`, `refuseComputer`, `resolveNeeds`, `RpcError`, `sdkVersion`); the rest is types, and the daemon reaches a plugin through the objects it hands over.
The resolve hook that gave every plugin the daemon's copy needed one mechanism per runtime: `module.registerHooks` on Node 22.15+ and Deno, `module.register` on older Node, and on Bun 1.4.0 `module.register` accepts the hooks and never calls them.
The `ERESOLVE` across a minor that started this is what `ahpd plugin update all` fixes, by moving every `@ahpd` plugin to the daemon's version together.

## Decision

npm installs the peer `@ahpd/sdk` in the configuration directory, as it always did, and a plugin imports that copy; the daemon registers no resolve hook.
Nothing in the daemon depends on a plugin's copy being its own: an error's JSON-RPC code is read from an error named `RpcError` with a numeric `code`, not from `instanceof RpcError`, since a Node error such as `execFile`'s carries a numeric exit code, and a plugin that needs the daemon's version reads `PluginContext.version`, not `sdkVersion()`.

Source: Softov, 2026-09-29, asked "can you explan what are we doing? server already have sdk... communication with plugins are function calls... you analised if you aren't overthinking things?", then "Which way should daemon/09 go?": "Drop the hook".

## Consequences

The same install works on Node, Bun and Deno, with no runtime-specific loading.
Two copies of the sdk may be in memory; only what is listed above had to stop caring.
An install npm refuses because another installed plugin peers an older sdk names that plugin and `ahpd plugin update all`.

## Options

- **The daemon serves its sdk.** A resolve hook per runtime maps every plugin's `@ahpd/sdk` to the daemon's copy and npm installs none; one copy in memory, and a third mechanism for Bun.
