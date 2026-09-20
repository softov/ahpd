---
title: The plugin contract lives in `@ahpd/sdk`, and only the loader is machine-touching
status: accepted
date: 2026-09-20
refs:
  - code://packages/sdk/src/types/host.ts#L132-L245 - `HostOptions`, which the contract is a naming-back of
  - code://packages/sdk/src/index.ts - where `createHost` and the ports are exported, and where the contract joins them
  - code://.project/plans/plugin/01-plugins-load-from-configuration/plan.md - the plan this decision corrects
  - code://.project/ideas/plugins.md - the shape, which named a package of its own for the contract
---

## Context

The first shape of this plan put the plugin contract in a new `packages/plugin` package, `@ahpd/plugin`, holding the SDK's own types named back plus one pure fold.
That package would declare `@ahpd/sdk` as its only dependency and export `Plugin`, `PluginHost`, `PluginSpec` and `foldHostOptions`, all of which are derived from `HostOptions` and the port interfaces.

A package whose content is another package's types is a package that can only ever version in lockstep with the one it re-exports.
It earns its own name, publish configuration, build line, path aliases, README, LICENSE and boundary declaration for no behaviour that is not already the SDK's.
There is also a direction the current design leaves open: if `createHost` ever takes `plugins` directly rather than a pre-folded options object, the SDK would need the `Plugin` type, and `sdk` to `plugin` to `sdk` is a cycle.

The split that does hold is between the contract and the machine.
Deciding what a plugin contributes, and composing several of them, touches nothing; resolving a spec against a directory, reading a `package.json` and importing a module touches a filesystem and a module loader.

## Decision

The plugin contract and the fold live in `@ahpd/sdk`: the types in `src/types/plugin.ts` and the pure `pluginHost` and `foldHostOptions` in `src/plugins.ts`, exported from `src/index.ts`.
The daemon keeps only the half that touches the machine, in `packages/server/src/plugins.ts`.
No `@ahpd/plugin` package is created.

## Consequences

A plugin author names one range, `@ahpd/sdk`, and it is the package they already need to implement an `Agent` or a port.
There is no fourth package and no alias, build line, boundary row or README for one.
The SDK gains two runtime exports beside `hostTools()` and `memorySessions()`, which are likewise concrete implementations rather than protocol; nothing moves into `src/types/`, which still imports no runtime value.
Extracting the contract later is a re-export package and is cheap; merging two packages back is not, which is the argument for starting where the types already are.

## Options

- **A `@ahpd/plugin` package**, the plan's first shape.
  Rejected: it exists to re-export the SDK's types, so its version is a second number for one contract, and a `createHost({ plugins })` one day would make `sdk` depend on `plugin` which depends on `sdk`.
- **Put the loader in the SDK as well.**
  Rejected: the SDK imports no filesystem and nothing runtime-specific so that it can be read and used anywhere, and resolving a spec and importing a module is exactly the machine-touching half.
- **Put the contract in `packages/server` beside the loader.**
  Rejected: a plugin author would then depend on the daemon to typecheck against the host they embed, and the daemon is the one package that is not a library.
