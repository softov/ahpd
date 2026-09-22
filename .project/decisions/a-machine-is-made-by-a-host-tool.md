---
title: A machine is made by a host tool, not by a resource write
status: accepted
date: 2026-09-22
refs:
  - code://packages/sdk/src/types/host.ts#L232-L254 - `HostTool` and `effects`, the contract a tool is written against
  - code://packages/sdk/src/types/resources.ts#L186-L211 - `ResourceProvider`, whose write half is absent here
  - code://packages/sdk/src/host.ts#L5258-L5290 - the write half, which passes a URI and nothing else
  - code://packages/sdk/src/sessiontools.ts - the host tools that ship, and the shape a new one follows
  - code://.project/research/host-owned-uri-resources.md - `request_disposable_computer`, the tool this answers
---

## Context

A `computer:` provider has to answer two different questions: what machines exist, and make me one.
The resource commands answer the first well - `resourceList`, `resourceResolve` and `resourceRead` take a URI and say what is at it - and answer the second badly: a write carries bytes and a mode, so "start a container from this image with these limits" has nowhere to go in one.
The protocol's shape for an action is a host tool, which the host offers to every session's model, reports in `SessionState.serverTools`, and the reference host uses for the same kind of operation.
The research named the tool it wanted and added that the master should authorize it; the master does not exist here yet, and a tool that waits for one cannot be used at all.

## Decision

Creating, releasing and running something in a machine are host tools: `request_disposable_computer`, `release_computer` and `computer_exec`.
The `computer:` resource stays read-only - list, resolve, status, capabilities - so a client browses what exists and never mutates anything through it.
The tools call the runtime directly today; when a master exists, it replaces the runtime behind the same tool names and signatures, and the tool is what does not change.

Source: the user, 2026-09-22, asked how a machine would be set up if the provider only reported them, and chose the tool route over a read-only provider.

## Consequences

An agent can ask for a machine, use it and throw it away inside a session, and the three tools say what they do through `effects`, so a backend with a policy can ask a person before one runs.
The authorization is the one the rest of the host already uses - the connection token decided who may connect, and a tool call happens inside a session a client started - with the provider's own guards (limits and a maximum count) as the second layer.
The resource half cannot make anything, so an operator who wants a machine no agent asked for still uses `scripts/computer.mjs`.
`computer_exec` runs a command in the container; that is less than the host already grants, because a client may open a terminal on the host itself through the `terminals` port.

## Options

- **Make a machine with `resourceMkdir` on `computer://<id>`.** Rejected: the call carries a URI and nothing else, so the image, the limits and the runtime would have to be guessed from the name or fixed by the host, and a create that ignores its arguments is a worse interface than a tool.
- **A `computer:` tool that only sends a request to a master.** Rejected for now: nothing answers it yet, and the tool's shape survives the master's arrival, so waiting buys nothing.
- **No tools, a read-only provider, machines made only by the operator's script.** Rejected: an agent cannot ask for a machine at all, which is the case the research opened with.
