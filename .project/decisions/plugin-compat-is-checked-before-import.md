---
title: A plugin loaded from a path is checked against its own manifest before its code is imported
status: accepted
date: 2026-09-20
refs:
  - code://.project/decisions/plugin-manifest-is-package-json.md - the `ahpd` key and the `peerDependencies` this reads
  - code://packages/server/src/update.ts#L28-L68 - `parse` and `newer`, the hand-written version comparison this reuses
  - code://.project/decisions/update-check-compares-versions-by-hand.md - why there is no semver dependency to reuse
  - file:///github/doop/packages/sdk/src/plugin-compat.ts - `validatePluginCompat`, which runs between the manifest parse and the import
  - file:///github/doop/pood/src/providers/plugins/plugin-loader.ts#L290-L310 - the check placed before `jiti.import` so incompatible code never executes
---

## Context

A plugin installed with npm carries its compatibility in `peerDependencies`, and npm refuses an install whose range the tree does not satisfy.
A plugin named as `--plugin ./some/dir` never goes through npm, so nothing checks that range, and nothing checks that the `ahpd` key it declares is a shape anything can read.
The difference matters because `import()` runs code: a plugin declaring `@ahpd/sdk@^0.9` against a running `0.6` is executed before anything notices, and a manifest whose `entry` points outside its own package is followed.
A directory spec also has to be turned into a file at all, and today only a file spec would resolve.

doop makes the same observation and answers it by validating `manifest.compat` between the parse and the import, so no plugin code executes when the range cannot be satisfied.

## Decision

A plugin resolved from a path is checked against its own manifest before `import()` is reached.
The manifest is `package.json`, and the keys are the ones decision 2 already names: `name`, `peerDependencies["@ahpd/sdk"]`, and the optional `ahpd` object.
The check refuses, with a message naming the file and the problem: a `package.json` that does not parse; an `ahpd` that is not an object; an `ahpd.entry` that is not a string or that resolves outside the package directory; and a `peerDependencies["@ahpd/sdk"]` the running `@ahpd/sdk` does not satisfy.
A range this host cannot read is refused rather than passed, so an unsupported spelling is a message and not a plugin that loads unchecked.
A directory spec resolves its entry through the manifest in the order `ahpd.entry`, `exports["."]`, `main`, `index.js`, and a directory with none of them is refused by name.
A bare module path has no manifest to read and is imported as it is, which is the scratch-plugin form and stays allowed.
The same check runs for an installed plugin, because the daemon cannot tell which spec npm checked and one rule is cheaper than two.

## Consequences

An incompatible or malformed plugin is refused before its code runs, which is the only moment the refusal is worth anything.
`peerDependencies` is the one field that states compatibility, so a plugin declares it once and npm and the daemon read the same thing rather than an `apiVersion` beside it.
The daemon grows a range comparison of its own, built on the version parse the update check already has rather than on a `semver` dependency.
A plugin that declares no `peerDependencies` is loaded, because absent is not incompatible and refusing it would break every scratch plugin.
`plugin list` can report `incompatible` without importing anything, which is the same check run for its answer rather than for a gate.

## Options

- **An `apiVersion` field**, as doop uses.
  Rejected: it is a second statement of a fact `peerDependencies` already carries, and doop needs it only because its plugins are scanned from a directory rather than installed.
- **No check for path specs, since npm checks the installed ones.**
  Rejected: the path form is the one with no installer behind it, which is exactly the case that needs the check.
- **Let a mismatch surface at the first call rather than before the import.**
  Rejected: by then the code has run, which is the thing a compatibility check exists to prevent.
- **A literal `manifest.json` beside `package.json`.**
  Rejected for the reason decision 2 rejects it: two files carrying the same fields, one of which npm does not read.
