---
title: A plugin file without its own package.json takes the enclosing package's manifest
status: open
date: 2026-09-28
severity: minor
blocks: []
refs:
  - "[code://packages/server/src/plugins.ts#L68-L76](../../packages/server/src/plugins.ts#L68-L76) - `nearestManifest`, which walks up to any `package.json`"
  - "[code://packages/server/src/plugins.ts#L344](../../packages/server/src/plugins.ts#L344) - `loadOne` reads and checks that manifest for a file spec"
  - "[code://packages/server/src/plugins.ts#L597](../../packages/server/src/plugins.ts#L597) - the listing does the same"
---

## Symptom

A plugin spec that names a file in a folder with no `package.json` is read with the manifest of whatever package encloses it.
With plugin/24's log, `packages/server/test/fixtures/plugin-throws/index.ts` logs `plugin @ahpd/server loading`.

## Cause

`nearestManifest` walks up from the file to the first directory holding a `package.json`, whichever package that is.

## Impact

The start line names the wrong plugin, and the enclosing package's `sdkRange` and `entry` are checked against a file that is not that package.
Real plugins ship their own `package.json`, so nothing breaks today.

## Workaround

Give a plugin its own `package.json`.

## Fix

Candidates, none chosen: stop the walk at the first `package.json` only when it names this file as its entry or lies in the spec's own folder; or read no manifest for a file spec and name the plugin by its module's `name`.
