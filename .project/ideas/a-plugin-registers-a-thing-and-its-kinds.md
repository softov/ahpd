---
title: A plugin registers a thing and its kinds
created: 2026-11-02
refs:
  - "[code://packages/sdk/src/host/handshake.ts#L452](../../packages/sdk/src/host/handshake.ts#L452) - `ahpd.resourceProviders`, the schemes a host lists today"
  - "[code://packages/sdk/src/types/plugin.ts#L1435-L1454](../../packages/sdk/src/types/plugin.ts#L1435-L1454) - `registerAdapter` and `registerEngine`, two kinds that each have their own call"
  - https://github.com/microsoft/agent-host-protocol/issues/537 - Softov's issue, section 4: each resource type with its manifest and operations, as a top-level `resources` key
---

Softov, 2026-11-02: "I was thinking more in a generic register. Where we could register a generic thing. and its kinds. More like connectors and tunnels. But for another things like crm clients, invoices, etc."

A plugin registers a thing, such as clients or invoices, and the host keeps the list and the operations on it.
A plugin, the same one or another, registers a kind of that thing, with its own form and handlers.
A client discovers each thing with its schema and operations, and draws it with no code for that thing.
Connectors, agents, tunnels and computers each have their own call today, so a new thing needs new host code.
The briefs `the-host-keeps-the-tunnels.md` and `a-computer-kind-comes-from-any-plugin.md`, on the `plugin/canvas-example` branch, are two cases this would cover.
