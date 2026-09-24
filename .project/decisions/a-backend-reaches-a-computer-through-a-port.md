---
title: A backend reaches a machine through a port the host carries
status: accepted
date: 2026-09-23
refs:
  - "[code://packages/agent-acp/src/connection.ts#L50-L60](../../packages/agent-acp/src/connection.ts#L50-L60) - the one `spawn` an ACP backend makes"
  - "[code://packages/agent-acp/src/types.ts#L42-L59](../../packages/agent-acp/src/types.ts#L42-L59) - `AcpOptions`, where a command and its working directory come from"
  - "[code://packages/sdk/src/types/agent.ts#L92-L141](../../packages/sdk/src/types/agent.ts#L92-L141) - `Start`, the ports a backend is handed"
  - "[code://packages/sdk/src/types/plugin.ts#L101-L140](../../packages/sdk/src/types/plugin.ts#L101-L140) - the `register*` methods a plugin has"
  - "[code://packages/computer/src/runtime.ts#L72-L86](../../packages/computer/src/runtime.ts#L72-L86) - `exec`, which collects output and is not a stdio channel"
  - "[code://scripts/boundary.mjs](../../scripts/boundary.mjs) - the dependency rule a backend importing a plugin would break"
---

## Context

A session that names a computer should have its agent run inside it, and the ACP backend is the one to prove it with: it spawns a single command and speaks the protocol over that child's stdio (`connection.ts:56`).
To spawn it inside a machine, something has to know how a machine is reached, and the two obvious homes are both wrong.

Importing `@ahpd/computer` from `@ahpd/agent-acp` makes a backend depend on one machine plugin, and a second plugin with a second runtime would not fit; the boundary script exists to keep package dependencies declared and honest, not to encourage this one.
Putting a command template in the ACP plugin's own options (`args: ['exec', '-i', '{{computer}}', ...]`) makes the machine a deployment fact rather than a session fact, and the session is where it is chosen.

The computer plugin already owns the runtime. What is missing is the host carrying an answer from that plugin to a backend, which is what every other port in `Start` does.

## Decision

`HostOptions` gains a `computers` port, contributed by the computer plugin through `registerComputers`, and `Start` carries it as `computers`.
The port answers how to reach one machine as a process: given a machine id and a command with arguments, it answers the command, arguments, environment and working directory to spawn instead, or a sentence saying why it cannot.
It is a descriptor rather than a running process, because the caller is the one that spawns and owns stdio, and a descriptor is a value a test can assert without a container.

A backend that is handed no `computers`, or is handed one that cannot reach the machine the session named, must refuse to start the session rather than run on the host in silence.

## Consequences

`@ahpd/agent-acp` stays free of any dependency on `@ahpd/computer`, and a second runtime plugin reaches backends through the same port because the port knows a machine and not a runtime.
The computer plugin's runtime keeps its own knowledge: `exec` stays what it is, for one command whose output is wanted, and the descriptor is what a long-lived stdio child needs.
A backend that ignores the port and spawns locally is the failure to watch for, and the contract is that it refuses instead; the acceptance test is what catches a backend that does not.
The port is a new `HostOptions` key and a new `register*` method, which `plugin-contributes-host-options` already calls the one-time cost of a new kind of contribution.

## Options

- **`@ahpd/agent-acp` imports `@ahpd/computer`.** Rejected: a backend would depend on one machine plugin, a second runtime would need a second dependency, and it breaks the package boundary the boundary script checks.
- **A command template in the ACP plugin's options.** Rejected: the machine would be a deployment fact rather than the session's choice, and two sessions on one host could not run in two machines.
- **The host spawns the backend process itself.** Rejected: the host does not know what an ACP server is, and `Start` exists precisely so a backend owns its own process.
- **`ComputerRuntime.exec` as it stands.** Rejected: it collects output and answers an exit code, so there is no stdio to speak a protocol over.
