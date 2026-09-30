---
title: A plugin loads the daemon's own @ahpd/sdk, and npm installs none beside it
status: superseded
superseded-by: decisions/a-plugin-uses-the-sdk-npm-installs-beside-it.md
date: 2026-09-29
refs:
  - "[code://packages/server/src/plugins.ts#L340-L370](../../packages/server/src/plugins.ts#L340-L370) - the loader checks a plugin's `@ahpd/sdk` peer range against the daemon's version"
  - "[code://packages/server/src/install.ts](../../packages/server/src/install.ts) - `npm install --prefix <config dir>`, which installs the peer `@ahpd/sdk` there"
---

## Context

Every `@ahpd/*` plugin declares `@ahpd/sdk` as a peer.
npm installs that peer once in the configuration directory, every plugin there shares it, and at runtime the plugins import that copy while the daemon runs its own.
An install therefore had to agree with the other installed plugins rather than with the daemon: on 2026-09-29 upgrading three plugins failed with `ERESOLVE` because a fourth, not even loaded, still needed the old sdk.

## Decision

The daemon maps every plugin's `@ahpd/sdk` import to its own copy, so one sdk is in memory.
npm installs plugins with `--legacy-peer-deps`, so it puts no `@ahpd/sdk` in the configuration directory.
A plugin is checked against the daemon's sdk only, as the loader already does, and a plugin never depends on another plugin's versions.

Source: Softov, 2026-09-29: "a plugin need to match sdk with system.. not with another plugin", then asked "How should a plugin get @ahpd/sdk, so it matches the daemon and not the other plugins?": "Daemon serves its sdk".

## Consequences

Updating one plugin touches only that plugin.
A plugin built for another sdk minor is refused at load with the loader's existing sentence, not at install.

## Options

- **The local sdk follows the daemon.** Installs pin the configuration directory's `@ahpd/sdk` to the daemon's version; two sdk copies stay in memory.
