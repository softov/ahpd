---
title: A plugin package is @ahpd/<name>, and an agent backend is @ahpd/agent-<name>
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/computer/package.json](../../packages/computer/package.json) - `@ahpd/computer`, a plugin named for what it is"
  - "[code://packages/agent-acp/package.json](../../packages/agent-acp/package.json) - `@ahpd/agent-acp`, a backend named with the `agent-` prefix"
  - "[code://.project/ideas/plugins.md](../ideas/plugins.md) - the idea that proposed `@ahpd/plugin-<name>`, corrected to this"
---

## Context

The packages this repository ships already follow two shapes.
Backends are `@ahpd/agent-claude`, `@ahpd/agent-cofold` and `@ahpd/agent-acp`.
Everything else is named for what it does: `@ahpd/computer`, `@ahpd/tunnel-devtunnel`.
The plugins idea still said a plugin that is not a backend would be `@ahpd/plugin-<name>`, which matches none of them.

## Decision

A plugin package from this repository is `@ahpd/<name>`.
An agent backend is `@ahpd/agent-<name>`.
There is no `plugin-` prefix.

Source: Softov, 2026-09-26, in the brief for the plugin gaps: "Plugin packages are `@ahpd/<name>`. Agent backends are `@ahpd/agent-<name>`. This matches `@ahpd/computer` and `@ahpd/tunnel-devtunnel`."

## Consequences

Every package in the scope is a plugin except `@ahpd/sdk` and `@ahpd/server`, so the prefix would say nothing.
The `agent-` prefix stays because a backend is the one kind a client names, through `provider`, and a person looks for it by that word.
A name that could be mistaken for the SDK or the daemon is not used for a plugin.
The loader still reads a name for nothing but a listing, so this binds what is published and not what loads.

## Options

- **`@ahpd/plugin-<name>` for everything that is not a backend.** Rejected: neither `@ahpd/computer` nor `@ahpd/tunnel-devtunnel` has it, and in a scope where nearly every package is a plugin the prefix carries no information.
