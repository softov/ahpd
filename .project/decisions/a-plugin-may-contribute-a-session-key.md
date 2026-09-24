---
title: A plugin may contribute a session config key
status: accepted
date: 2026-09-23
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L101-L140](../../packages/sdk/src/types/plugin.ts#L101-L140) - every `register*` a plugin has today"
  - "[code://packages/sdk/src/types/agent.ts#L151-L152](../../packages/sdk/src/types/agent.ts#L151-L152) - `Agent.schema()`, where a session's config schema comes from"
  - "[code://packages/sdk/src/host.ts#L3051-L3072](../../packages/sdk/src/host.ts#L3051-L3072) - `published`, which strips this host's own field from that schema"
  - "[code://packages/sdk/src/host.ts#L2486](../../packages/sdk/src/host.ts#L2486) - `Start.settings`, the resolved config a backend receives"
  - "[code://packages/sdk/src/host.ts#L3014-L3020](../../packages/sdk/src/host.ts#L3014-L3020) - `settle`, where a new session's config is resolved"
  - "[code://docs/USERS.md](../../docs/USERS.md) - the session settings a client draws a control from"
  - "[code://.project/research/a-computer-three-things.md](../../.project/research/a-computer-three-things.md) - the four shapes this chose between"
---

## Context

A session's config schema is the backend's: the host publishes `agent.schema()` and draws nothing of its own beside it.
`PluginHost` has no registration for one, so a plugin can contribute a store, a provider, an agent or a tool, and cannot contribute a setting a person chooses before the session exists.

The user wants a session to name the computer it runs in, and asked whether the plugin contributing that key is "the idea" so "it will show on session before creating".
It is, and the schema is the only place a client learns what to draw.

The alternatives all work and each costs something: a host key in the core, a workspace URI, or one host-wide machine.

## Decision

`PluginHost` gains `registerSessionConfig(key, schema)`, and the host merges every registered key into the session schema it publishes, beside the backend's own.
The key exists only while the plugin is loaded, which is what "if plugin is loaded" means, and it reaches the backend in `Start.settings` with the client's value, because the host already resolves the session's config from the schema before it starts one.
A key a plugin registers must not collide with a backend's own, and a collision is refused at the plugin boundary rather than merged, the way a duplicate scheme is.

The host does not read the key itself.
A plugin that contributes `computer` states what it means in the schema, and the backend that can act on it reads it from `Start.settings`; a backend that cannot act on it must refuse rather than run somewhere nobody asked for.

## Consequences

A plugin contributes a setting the same way it contributes everything else: one `register*` method and one check at the boundary, which is what `plugin-contributes-host-options` already says adding a kind of contribution costs.
The computer can be chosen per session without the core learning what a container is, and a second plugin with a session-level setting uses the same seam rather than asking for a second mechanism.
The value's meaning is split: the plugin declares the key, the person picks it, and the backend honours it. A backend that ignores a key it received is the failure to watch for, and the contract is that it refuses instead.
A session schema published before the plugin loaded is published without the key, which is correct and not a gap: the key does not exist until its plugin does.

## Options

- **A host key in the session schema.** Rejected: it is drawn for every session whatever backends are loaded, and the core would carry a key whose meaning belongs to one plugin.
- **The session's working directory is a `computer://` URI.** Rejected: a working directory is a host path today, the terminals check theirs against the directories this host serves, and it moves files rather than the process, so it is not the sandbox that was asked for.
- **A host-wide default computer in the root config.** Rejected: one machine for every session, which is the opposite of fire, run and die per session.
- **A second configuration file the backend reads for itself.** Rejected: it is outside the session and the protocol, so a client cannot draw it, a second client cannot see it, and the value would not travel with the session it belongs to.
