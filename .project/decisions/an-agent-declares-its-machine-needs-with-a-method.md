---
title: An agent declares what a machine needs through a machine() method
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/types/agent.ts#L281-L283](../../packages/sdk/src/types/agent.ts#L281-L283) - `schema()` and `defaults()`, the other methods that describe an agent to the host"
  - "[code://packages/sdk/src/types/plugin.ts#L134-L138](../../packages/sdk/src/types/plugin.ts#L134-L138) - `registerSessionConfig`, the shape of the rejected registration"
  - "[code://.project/ideas/an-agent-says-what-a-machine-needs.md](../ideas/an-agent-says-what-a-machine-needs.md) - the idea this settles one part of"
---

## Context

A machine a session runs in needs things from the host for the agent to run there: for Claude, its configuration directory, `.claude.json` and the CLI binary. Today a computer profile lists them as mounts by hand. The idea is that the agent declares them and whatever makes the machine supplies them.

## Decision

`Agent` gains an optional `machine()` method, beside `schema()` and `defaults()`, that answers the named needs. Source: Softov, asked "whether the SDK surface is a plugin registration or a method on `Agent`", answered "machine() method on Agent".

Accepted 2026-09-26: Softov, asked "The machine-needs decision ... is still 'proposed'. Accept it?", answered "Accept, and plan it next".

## Consequences

The needs travel with the agent, so an agent handed to `createHost` without the plugin system declares them too, and no key is needed since an agent is its provider. The public `Agent` type gains an optional member. The host still needs a way to hand an agent's needs to a plugin that makes machines.

## Options

- **`registerMachineNeeds(provider, needs)` on the plugin host.** Like `registerSessionConfig`, but it works only for an agent loaded as a plugin, and keys the needs by a provider name instead of the agent that has them.
