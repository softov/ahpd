---
title: ahpd installs the daemon's own @ahpd/sdk version beside the plugins, and npm checks no peers
status: accepted
date: 2026-09-29
supersedes: decisions/a-plugin-uses-the-sdk-npm-installs-beside-it.md
refs:
  - "[code://packages/server/src/install.ts](../../packages/server/src/install.ts) - `npm install --prefix <config dir>` for install and update"
  - "[code://packages/server/src/plugins.ts](../../packages/server/src/plugins.ts) - the loader checks each plugin's `@ahpd/sdk` peer range against the daemon's version"
---

## Context

Every plugin is installed into one npm project, the configuration directory, and each declares `@ahpd/sdk` as a peer.
npm then wants one `@ahpd/sdk` there that satisfies every installed plugin, so a plugin on one minor blocks installing or updating another on the next: on 2026-09-29 `ahpd plugin update @ahpd/agent-acp` was refused because `@ahpd/agent-claude` 0.7.0 was installed beside it.
The daemon never needed that agreement: the loader already judges each plugin against the daemon's own sdk, one plugin at a time.

## Decision

Every `plugin install` and `plugin update` runs npm with `--legacy-peer-deps` and names `@ahpd/sdk` at the daemon's version beside the plugins, so the configuration directory's one `@ahpd/sdk` is the daemon's version and no plugin's peer range is checked against another's.
Whether a plugin fits is decided at load, plugin against daemon, by the loader's existing check.
Nothing depends on a plugin's copy being the daemon's module: an error's JSON-RPC code is read from an error named `RpcError` with a numeric `code`, and a plugin that needs the daemon's version reads `PluginContext.version`.

Source: Softov, 2026-09-29: "the sdk owner is the daemon.. the daemon has the SDK. So like.. what claude have to do with acp? ... lets talk about just plugin and daemon.", then asked "Should the config folder's @ahpd/sdk be the daemon's version, installed by ahpd itself, with npm told to ignore peers so plugins never block each other?": "Daemon pins the sdk".

## Consequences

Installing or updating one plugin never depends on the others.
A plugin built for another minor installs and is refused at load with the loader's sentence.
Two copies of the sdk at the daemon's version are in memory, the daemon's and the configuration directory's.
It works the same on Node, Bun and Deno: nothing is resolved differently at runtime.

## Options

- **npm resolves the peer.** Plugins on different minors block each other, and a named update is refused with a line saying to run `update all`.
- **The daemon serves its sdk through a resolve hook.** One copy in memory, but a mechanism per runtime, and none that runs on Bun.
