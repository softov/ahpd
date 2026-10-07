---
title: A plugin file takes the nearest manifest only when it is a plugin's - implemented
date: 2026-10-07
refs:
  - git://5221af7
  - "[code://packages/server/src/plugins.ts](../../../../packages/server/src/plugins.ts)"
---

A plugin given as a file takes the nearest `package.json` only when that manifest has an `ahpd` field.
A file with no plugin manifest above it is named by its module's `name` export or its file name.
No other package's checks apply to it.
A file inside a plugin package, such as `./packages/agent-claude/src/index.ts`, still takes that package's manifest.

## What was built

- [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts) - `nearestManifest` takes the nearest `package.json` only when it has an `ahpd` field.
- The plain walk is now `enclosingPackage`, which `resolvePlugin` keeps for a bare name resolved through the configuration directory.
- `fileNameOf` names a file spec with no manifest: the file's name without its extension, or its directory's name for an `index` file.
- The load names the spec with `fileNameOf`, then takes the module's `name` export when there is one.
- The listing imports nothing, so it names the row with `fileNameOf`.

## Verified

- [`code://packages/server/test/plugin-load.test.ts`](../../../../packages/server/test/plugin-load.test.ts): `plugin-throws` logs `plugin plugin-throws loading`, and a file under a non-plugin `package.json` with a `^99.0.0` peer range loads as `loose`.
- [`code://packages/server/test/plugin-list.test.ts`](../../../../packages/server/test/plugin-list.test.ts): a file under a non-plugin manifest lists by its file name, and `packages/agent-claude/src/index.ts` lists as `@ahpd/agent-claude`.
- [`code://packages/server/test/plugin-resolve.test.ts`](../../../../packages/server/test/plugin-resolve.test.ts): a bare name still resolves through the configuration directory.
- All new cases failed first, except the agent-claude case, which held before and after.
- Softov reviewed the task on 2026-10-06.

## Departures from the plan

- The listing names a file spec with no manifest by its file name, not `(no manifest)`.
  That label is left for a spec with no path, such as one with a scheme.
- The plan did not say what the file name of an `index.ts` is; it is the directory's name, after the task's own `plugin-throws` example.

## Left for later

- None.
