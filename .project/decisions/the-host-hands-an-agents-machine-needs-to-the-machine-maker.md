---
title: The host hands an agent's machine needs to the plugin that makes the machine
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/types/computers.ts#L47-L49](../../packages/sdk/src/types/computers.ts#L47-L49) - `ComputerPort`, the port the needs travel through"
  - "[code://packages/sdk/src/types/completions.ts#L27](../../packages/sdk/src/types/completions.ts#L27) - the `computer` answerer is told the `provider`, so it can filter by it"
  - "[code://.project/ideas/an-agent-says-what-a-machine-needs.md](../ideas/an-agent-says-what-a-machine-needs.md) - the open item this settles"
---

## Context

An agent declares its needs with `machine()`, and a plugin makes machines.
The plugin that registers an agent may load after the plugin that makes machines, and only the host knows both a session's agent and its computer.

## Decision

The host hands the needs over.
A machine made for a session (disposable, or a dev container on first use) is created by the host calling the computers port with the profile, the agent's `machine()` answer and the session's folder.
A long-lived machine whose profile lists `agents` asks the host `machineNeeds(provider)` at create time, never at load.
The machine records the agents it was prepared for as a label, which the `computer` answerer filters by and the host checks before a session starts there.
Source: Softov, 2026-09-26, asked "how does the plugin that makes machines get an agent's machine() needs?", answered "Host hands them over".

## Consequences

The computer plugin never looks an agent up, and load order does not matter.
The port gains the needs as an input to create, which a `kvm` runtime takes the same way.

## Options

- **The plugin looks agents up.** `host.agents()` and a `machine()` read on every create; a simpler port, and a plugin that has to know about agents and when they are loaded.
