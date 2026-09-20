---
title: The plugin manifest is an `ahpd` key in package.json, and the module is still the contract
status: accepted
date: 2026-09-20
refs:
  - code://.project/ideas/plugins.md - the loading shape this decision completes
  - file:///github/pi/packages/coding-agent/src/core/pi-manifest.ts - the `pi` key pi reads out of a package before loading it
  - file:///github/deepseek-harness/packages/boot/app-boot/src/profile.ts - the `dsh.bundle` and `dsh.client` keys deepseek-harness reads
  - npm://@ahpd/sdk@^0.6 - the peer range a plugin declares for compatibility
---

## Context

A plugin can be a bare module path, an npm package or a directory, and the loader has to know two things before it runs anything: what to import, and what to call it in a listing.
Compatibility it does not have to be told, because a plugin that is a package already declares it.

Both references put that metadata in `package.json`.
pi reads a `pi` key with an `extensions` list.
deepseek-harness reads `dsh.bundle` and `dsh.client`.
Neither invents a file of its own.

## Decision

An npm plugin may declare an `ahpd` key in its `package.json`, and no `manifest.json` is introduced.
The key is optional and carries only what must be known before the module is imported.

```json
{
  "name": "@ahpd/plugin-facio",
  "type": "module",
  "exports": { ".": "./dist/index.js" },
  "peerDependencies": { "@ahpd/sdk": "^0.6" },
  "ahpd": { "entry": "./dist/index.js", "title": "Facio" }
}
```

`entry` names what to import when the package's `exports` is not enough to say.
`title` is what a listing prints.
`needs` and `provides` join the key when plugin ordering does.
The imported module stays the contract: it must export `apply`, it may export `name`, and no manifest field supplies behaviour.
When both name the entry the manifest wins for resolution and the module wins for shape, and the loader reports a mismatch between the two rather than choosing silently.

## Consequences

Listing what is installed without running it is possible, which is the whole reason the key exists.
A `manifest.json` would have made the same thing possible while adding a file npm does not read, a second place to write the package's own name, and a format to document and validate.
Compatibility needs no field at all, because `peerDependencies` is resolved by the package manager the plugin was installed with.
A plugin that is a single file still works, with no `package.json` and no key, which is what a scratch plugin and a test fixture are.

A package whose `ahpd.entry` drifts from its `exports` is a package that loads differently from how it resolves, so the loader checks the two and says so.
A manifest that promises a `name` the module contradicts is a listing that lies, so the module's `name` wins and the manifest's is the fallback.

## Options

- **A separate `manifest.json` at the package root.**
  Rejected: npm already reads and resolves `package.json`, so the second file duplicates `name`, `version` and `dependencies` while being invisible to the installer, and no reference does it.
- **No manifest at all, module exports only.**
  Rejected as the only form: listing installed plugins would import every one of them, which runs third-party code to print a name, and a package with several entry points cannot say which one is the plugin.
  Kept as the fallback form, because a bare file path has no manifest to read and must still load.
