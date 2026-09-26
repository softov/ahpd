---
title: A cofold session in a computer runs in an ahpd started inside it
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L605](../../packages/agent-cofold/src/agent.ts#L605) - `refuseComputer`, what cofold does with a computer today"
  - "[code://.project/research/a-backend-inside-a-machine.md](../research/a-backend-inside-a-machine.md) - route two, a whole host inside the machine, the only route that covers cofold"
  - "[code://.project/decisions/a-nested-host-speaks-stdio.md](a-nested-host-speaks-stdio.md) - `ahpd --stdio`, built for dev containers"
---

## Context

Cofold's tools act on the machine its process runs on, and cofold has no server mode a process outside a machine could drive: no ACP, and `papo` runs an agent only in its own process.
Claude reaches a machine by running its CLI there; cofold needs the same, a process of its own inside.

## Decision

A cofold session on a `computer://` runs in `ahpd --stdio` with `@ahpd/agent-cofold`, started inside the machine through the computers port, and the outer host carries its frames.
Source: Softov, 2026-09-26, asked "How should ahpd run cofold inside a machine?", answered "Nested ahpd --stdio".

## Consequences

No cofold change, and the route works for any backend a nested host can load.
The machine has to hold what cofold needs: its config, the provider key and the plugin, which is the [machine-needs idea](../ideas/an-agent-says-what-a-machine-needs.md).
The dev container relay carries frames for a client; this carries them for a session the outer host owns, which is new.

## Options

- **Cofold gains an ACP server mode.** `@ahpd/agent-acp` already moves into machines, and Zed could drive cofold too, but it is a cofold feature to build first.
- **Cofold gains an AHP stdio mode of its own.** Lighter than a whole ahpd, and a second AHP implementation to keep.
