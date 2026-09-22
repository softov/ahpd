---
title: An ACP backend reaches files and a shell through Start
status: accepted
date: 2026-09-22
refs:
  - code://packages/sdk/src/types/agent.ts#L90-L168 - `Start`, where the two fields are added
  - code://packages/sdk/src/types/host.ts - `HostOptions.resources` and `HostOptions.terminals`, the ports the host already holds
  - code://.project/ideas/agents-as-extensions.md - the order that puts "ports through `Start`" before the ACP package
  - code://.project/plans/plugin/01-plugins-load-from-configuration/deferred.md - where this wait was recorded
---

## Context

An ACP agent asks its client for `fs/read_text_file`, `fs/write_text_file` and `terminal/create`, and a bridge is the client.
`Start` carries `tools` but neither `resources` nor `terminals`, so a bridge that answered those requests itself would open the filesystem and spawn the shell a second time, beside the host that already does both.
The idea ordered this change before the package, and two implementations of "read this file" and "run this command" is one too many.
This host grants any `file:` URI a client asks for - the connection token is the boundary, not a directory - so handing `resources` down is the same access a client already has rather than a widening of it.

## Decision

`Start` gains `resources` and `terminals`, and an ACP session advertises `fs.readTextFile`, `fs.writeTextFile` and `terminal` only when the matching one is present.
`resources` is the store itself, because this host serves any `file:` URI a client asks for, so handing it down is the same access a client already has.
`terminals` is not the port: the host owns a terminal's channel URI, its registration in the root list and the `emit` that routes its actions, and a backend calling the raw store got none of that and dispatched its terminal's actions to the session channel instead. It is a host-owned factory, `StartTerminals.open(OpenTerminal)`, which mints the URI, registers the terminal, routes its emit, and answers with an `OpenedTerminal` carrying `uri`, `output()`, `waitForExit()`, `write`, `resize`, `kill` and `release`.
`TerminalOptions` gained `args` and `env`, and `Terminal` gained `waitForExit`, because ACP's `terminal/create` sends an argv and an environment and its `terminal/wait_for_exit` needs something to await.

Source: (defaulted: [agents as extensions](../ideas/agents-as-extensions.md) orders "ports through `Start`" and rejects building the access twice; confirmed on review, and the terminal seam chosen over the raw port.)

## Consequences

`packages/sdk/src/types/agent.ts` gains the two optional fields, and every backend that ignores them is unaffected.
`@ahpd/agent-acp` is the first consumer, and `@ahpd/agent-cofold` may later read the same ports rather than wiring its own store.
`plugin/01`'s deferred row for ports through `Start` closes with this plan.

## Options

- **Add the ports to `Start`**, which is the direction taken.
- **Give the bridge its own `resources` and `terminals` options.**
  Rejected: it puts the reachability answer outside `within()`, and the idea already refused doing that twice.
- **Advertise no `fs` or `terminal` capability, so the server never asks.**
  Rejected as the resting state: it leaves every ACP agent without file or shell access, which is most of what makes one useful.
