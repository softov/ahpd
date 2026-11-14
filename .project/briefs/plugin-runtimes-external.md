---
title: A plugin runs outside the daemon's process
created: 2026-11-14
refs:
  - git://9b15ce74a - the commit of ahpd the facts were checked at
  - "[code://packages/server/src/plugins.ts#L1344](../../packages/server/src/plugins.ts#L1344) - a plugin is loaded with `import()`, into the daemon's process"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1645-L1657](../../packages/sdk/src/plugins/plugins.ts#L1645-L1657) - `connect`: a plugin's connection is an in-memory pair, served as `plugin:<name>`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1956-L2090](../../packages/sdk/src/plugins/plugins.ts#L1956-L2090) - registrations such as `registerRoute`, `registerTunnelKind` and `on` are calls into the host, not frames"
  - "[code://packages/activepieces/src/plugin.ts#L258-L301](../../packages/activepieces/src/plugin.ts#L258-L301) - the activepieces plugin forks its engine and talks to it with messages"
  - "[code://.project/decisions/a-nested-host-speaks-stdio.md](../decisions/a-nested-host-speaks-stdio.md) - a nested host speaks AHP over stdio, admitted as the host itself"
  - "[code://.project/briefs/a-plugin-asks-for-its-grants.md](a-plugin-asks-for-its-grants.md) - the grants a plugin asks for, which this brief would make a real limit"
---

# A plugin runs outside the daemon's process

Softov's goal: a plugin runs in a process of its own, or reaches the host as a connection from outside.
It does not have to run in the daemon's process.

## Why

- A plugin in the daemon's process can do what the daemon's OS user can do. Its grants limit only the calls it sends on its connection, not the Node APIs it imports.
- So the grants in [a-plugin-asks-for-its-grants.md](a-plugin-asks-for-its-grants.md) are a limit only for a plugin that is outside the process.
- A stuck plugin in the process cannot be stopped at shutdown. A timer cannot end CPU-bound code. A process can be killed.

## What ahpd has now

- The daemon loads a plugin with `import()`. Every plugin runs in the daemon's process.
- A plugin's connection is an in-memory pair, served as the principal `plugin:<name>` with its entry's grants.
- A plugin registers agents, routes, operations, tunnel kinds, computers and event handlers with calls into the host. These calls are not frames.
- The activepieces plugin forks its engine as a child process and talks to it with Node messages. The plugin itself still runs in the daemon.
- A nested host speaks AHP over stdio. A connection over stdio is admitted as the host itself.
- Any AHP client can connect over a socket with a token, as a person. A client cannot register an agent or a route.

## Two ways, to discuss

- **As a process.** The daemon starts the plugin as a child and speaks to it over stdio, as it does with a nested host. The connection is the plugin's principal, not the host. The daemon can restart or kill it.
- **As a connection.** The plugin is a program that runs somewhere else, such as another machine or a computer. It connects to the host with a credential of its own, and the host serves it as `plugin:<name>`.
- In both, the registrations go over the wire, so each of them needs a frame.
- In-process loading stays, for plugins a person trusts.

## Questions for a plan

- Which runtime is the default for a first-party plugin, and for a third-party one?
- Which registrations cross the wire first: agents, routes, operations, events, or all?
- Are the registrations AHP extension methods, or a wire of the plugin API's own?
- How does a connected plugin prove it is `plugin:<name>`, and who issues its credential?
- Does a person pick the runtime in the plugin's entry, or does the manifest say what the plugin supports?
