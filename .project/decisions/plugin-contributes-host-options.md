---
title: A plugin contributes the host's own options, and there is no service container
status: accepted
date: 2026-09-20
refs:
  - code://packages/sdk/src/types/host.ts#L132-L245 - `HostOptions`, the option object a plugin contributes to
  - code://packages/server/src/main.ts#L342-L433 - the literal the daemon hands `createHost`, which is what a plugin replaces
  - code://.project/ideas/plugins.md - the shape this decision fixes
  - file:///github/deepseek-harness/vendor/cordis/src/registry.ts#L92-L187 - the container and `ctx` proxy this decision does not adopt
  - file:///github/pi/packages/coding-agent/src/core/extensions/types.ts#L1257-L1523 - the `ExtensionAPI` this decision narrows
---

## Context

ahpd has one composition point, `createHost(options: HostOptions)`, and its ports are handed in rather than reached for.
`HostOptions` already names every contribution a plugin would want: `agents`, `tools`, and the ports `resources`, `terminals`, `changes`, `directories`, `worktrees`, `github`, `automations` and `sessions`, plus `diagnostics` and `onEvent`.
The only thing wrong today is that `packages/server/src/main.ts` writes that object as a literal, so a second backend or a second resource store is a source edit and a rebuild.

Both references solve this with a container.
deepseek-harness mounts each plugin on a cordis context and publishes services as `ctx.<name>`, resolving load order from what a plugin injects.
pi hands each extension an `ExtensionAPI` of some two dozen registration methods and an event bus.
Neither is what ahpd needs to close its gap.

## Decision

A plugin is a module whose named export `apply(host: PluginHost, options)` contributes to the same option object the daemon already builds.
`PluginHost` names the `HostOptions` keys back through `register*` methods: `registerAgent` and `registerTool` append, and one method sets each of the nine singleton ports, `registerResources` through `registerDiagnostics`. `log`, `path`, `paths` and `version` are read-only context and are not registrations.
Every registration is checked against the contract it satisfies before it is recorded, so a value the daemon did not write is refused at the boundary rather than failing somewhere inside the host.
There is no `ctx`, no service registry and no event bus in the first implementation.
Plugins apply in the order they are configured.

## Consequences

The contract is one page and a plugin author depends on types alone.
No dependency is added to the daemon, and an embedder can fold plugins the same way the daemon does.
Adding a new kind of contribution is the same one-time change with or without a container: a `HostOptions` key and a `PluginHost` method.
The check on a registration is a few `typeof` tests per contract, not a dependency, and it is the same check for a JavaScript plugin and a TypeScript one because the type is gone by the time either runs.

A plugin cannot observe a host it did not build, and it cannot ask for one that is not there.
A plugin that wants to watch a running host is a client instead, which the protocol already supports.
Cross-plugin ordering is configuration order until a plugin proves it needs more, at which point `needs` and `provides` are a small addition rather than a rewrite.

## Options

- **A cordis-style container**, as deepseek-harness uses.
  Rejected: it is a second framework inside a library whose whole claim is that it has none, and dependency-injected ordering solves a problem that does not exist until one plugin depends on another.
- **A pi-style `ExtensionAPI` with an event bus.**
  Rejected for the first implementation: most of pi's surface is terminal UI, which ahpd has no equivalent of, and the parts that map, tools and providers, are already in `HostOptions`.
- **A plugin as a whole launcher**, a separate binary that calls `createHost` with the daemon's options plus its own.
  Rejected: it abandons the configuration file, the verbs and the daemon record, which is exactly what a plugin should extend rather than replace.
