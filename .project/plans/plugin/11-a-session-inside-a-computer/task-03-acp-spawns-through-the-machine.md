---
title: ACP spawns through the named machine
status: done
depends:
  - task-02-the-host-carries-the-computers-port.md
layer: packages/agent-acp
refs:
  - "[code://packages/agent-acp/src/agent.ts](../../../../packages/agent-acp/src/agent.ts) - where a session opens and `Start` arrives"
  - "[code://packages/agent-acp/src/connection.ts#L50-L60](../../../../packages/agent-acp/src/connection.ts#L50-L60) - the `spawn` this replaces with the descriptor"
  - "[code://packages/agent-acp/src/types.ts#L42-L59](../../../../packages/agent-acp/src/types.ts#L42-L59) - `AcpOptions`, which the descriptor overlays"
  - "[code://packages/agent-acp/src/types.ts](../../../../packages/agent-acp/src/types.ts) - `AcpConnectionOptions`, which gains the descriptor"
  - "[code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts) - `HostOptions`, where `ComputerPort` is declared by task 02"
  - "[code://packages/sdk/src/types/agent.ts#L96-L97](../../../../packages/sdk/src/types/agent.ts#L96-L97) - `Start.settings`, where the session's choice arrives"
  - "[code://test/agent-acp.test.ts](../../../../test/agent-acp.test.ts) - the cases"
---

## Objective

When a session's settings carry `computer: 'computer://<name>'`, the ACP backend asks `Start.computers` how to reach it and spawns the server through that descriptor. When there is no port, or the machine cannot be reached, the session refuses with a sentence rather than running on the host.

## Files

- `UPDATE: packages/agent-acp/src/agent.ts` - read `settings.computer`, ask `start.computers.how`, and pass the answer down.
- `UPDATE: packages/agent-acp/src/types.ts` - `AcpConnectionOptions` gains the resolved command, arguments, environment and working directory, defaulting to the plugin's own.
- `UPDATE: packages/agent-acp/src/connection.ts` - spawn the descriptor when one was given.
- `UPDATE: test/agent-acp.test.ts` - a session naming a machine spawns the descriptor's command, and a session naming one with no port refuses.
- `UPDATE: test/plugin-compat.test.ts` if the plugin's declared behaviour is asserted there.

## Steps

1. Read `settings.computer` as a string, and treat anything that is not a `computer://<id>` as a sentence rather than a spawn.
2. With a value and no `Start.computers`, refuse the session: the person asked for a machine and the host cannot give one.
3. With a value and a port, ask `how(id, { command, args, cwd })` and overlay the answer on the plugin's own options; a sentence instead of a descriptor refuses.
4. With no value, spawn exactly what the plugin was configured with, so a session that names no computer is what every session is today.

## Validation

- `test/agent-acp.test.ts` - a fake port answers `docker exec -i -w /w box cmd` and the connection spawns it; a session with a `computer` and no port is refused with a sentence; a session with none spawns the configured command.
- `test/agent-acp.test.ts` - the environment is the plugin's with the descriptor's over it, and the daemon's own environment is not handed to the machine.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Not started.
The descriptor is a value, so the case needs no Docker: the fake port is the machine.
