---
title: A plugin registers from a closed set of kinds, one method each
status: accepted
date: 2026-09-20
refs:
  - code://.project/plans/plugin/00-plugin.md - where the closed set is listed
  - code://.project/decisions/plugin-contributes-host-options.md - the surface these kinds are methods on
  - file:///github/doop/plugins/STRUCTURE.md - the "Registration Targets" table, which is the same idea written down and kept current
  - file:///github/doop/packages/sdk/src/plugin.ts#L41-L186 - `PluginApi`, one `register*` per capability, and the removal of `registerChatCommand` and `registerFlowAction` in favour of surface flags on `registerTool`
  - file:///github/doop/packages/sdk/src/plugin-api-version.ts - a `PLUGIN_API_VERSION` independent of the package version
  - code://.project/proposals/agent-host-protocol-extension-methods.md - the protocol half of a plugin-served method
---

## Context

The plan names three things a plugin contributes, `agent`, `tool` and `port`, and lists the nine port keys, but nothing anywhere enumerates the closed set of kinds.
That is the gap a reader hits: "what can a plugin register" is answerable only by reading the `PluginHost` interface sketch and inferring the rest.

doop answers this twice over.
`plugin.ts` declares a `PluginApi` with one `register*` method per capability, and `plugins/STRUCTURE.md` carries a "Registration Targets" table naming the registry each one lands in.
It also carries the lesson that the method count grows: `registerChatCommand` and `registerFlowAction` were removed in favour of flags on `registerTool`, because two kinds that differ only in where the value is shown are one kind.

## Decision

A plugin registers from a closed set of kinds, and each kind is one method on `PluginHost`.
The list is kept in `plans/plugin/00-plugin.md` and repeated here in short: agent, tool, port, customization, MCP server, hook, configuration key, host method, and log sink.
An open-ended `contribute(name, value)` bag is rejected: a bag cannot be typed, cannot be checked at the call site, and cannot be listed.
The first plan implements `agent`, `tool` and `port` only, and every other kind is named in the domain reference with the plan it belongs to, so a plugin author sees the whole surface from the first release and knows what is not there yet.
`port` is the one method parameterized by a kind, and it is not the bag this decision rejects.
`port<K extends PortKey>(key: K, value: PortOf<K>, when?)` takes a key from a union written out as the nine ports and a value whose type is looked up from that key, so a wrong key and a wrong value are both compile errors.
Every other kind is a method that takes no key.
A contribution that is not one of the nine gets a method of its own rather than a tenth `port` key, and adding a port is a deliberate change to `PortKey` and to the table in the domain reference.

## Consequences

"What can a plugin register" has one answer in one place, and a new kind is a new row plus a new method rather than a discovery.
A kind that lands nowhere is visible as a missing row rather than as a method that silently does nothing.
`port` is the one place a key is passed, which reads as a wildcard and is not one: it is generic so that nine structurally identical ports are not nine near-identical methods that drift from `HostOptions`, and `PortKey` is written out rather than derived from `HostOptions` so that membership cannot grow without a row.
A JavaScript plugin can of course pass a value the type system would have refused, and nothing validates it at runtime, because ahpd has no validator and a plugin is trusted code with the daemon's permissions; the type is a contract for an author, not a fence.
Nine kinds is more surface than three, so the first plan implements three and the table's status column keeps the rest honest.

Two kinds name a value that ahpd does not yet accept from anywhere but its own source: a customization needs `HostOptions.customizations` and a configuration key needs `ROOT_CONFIG_SCHEMA` to become an option.
Both are `@ahpd/sdk` changes and both are follow-up plans, which is why the table is written now and the methods are not.

## Options

- **An open bag**, `contribute(name: string, value: unknown)`.
  Rejected: it moves every mistake to runtime, makes autocomplete useless, and a listing has nothing to enumerate.
- **One method per kind**, as doop's `PluginApi` does.
  Chosen, because the kinds map onto `HostOptions` keys that already exist and a method each is what makes the type check at the call site.
- **Few kinds with surface flags**, the direction doop moved in when it collapsed two command registrations into `registerTool`.
  Kept as the tie-breaker rather than the starting point: when two kinds differ only in where the value lands, they become one method with a surface field, and the table gains no row.
