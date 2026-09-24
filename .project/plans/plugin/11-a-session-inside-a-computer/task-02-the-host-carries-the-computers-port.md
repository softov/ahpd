---
title: The host carries the computers port
status: done
depends: []
layer: packages/sdk, packages/computer
refs:
  - "[code://packages/sdk/src/types/agent.ts#L92-L141](../../../../packages/sdk/src/types/agent.ts#L92-L141) - `Start`, where the port is carried"
  - "[code://packages/sdk/src/types/plugin.ts#L101-L140](../../../../packages/sdk/src/types/plugin.ts#L101-L140) - `register*`, where `registerComputers` goes"
  - "[code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts) - `HostOptions`, where the port is declared"
  - "[code://packages/sdk/src/host.ts#L2444-L2490](../../../../packages/sdk/src/host.ts#L2444-L2490) - `spawn`, the `Start` builder"
  - "[code://packages/computer/src/runtime.ts](../../../../packages/computer/src/runtime.ts) - the runtime behind the port"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - where the plugin registers it"
  - "[code://test/plugin-host.test.ts](../../../../test/plugin-host.test.ts) - the port registration cases"
---

## Objective

`HostOptions` has a `computers` port, the computer plugin registers it with `registerComputers`, `Start` carries it to every backend, and it answers how to reach a named machine as a process: a command, arguments, environment and working directory, or a sentence saying why not.

## Files

- `CREATE: packages/sdk/src/types/computers.ts` - `ComputerPort` with `how(id, options): Promise<Spawn | undefined>`, `Spawn { command, args, env?, cwd? }`, and the prose contract.
- `UPDATE: packages/sdk/src/types/host.ts` - `HostOptions.computers?: ComputerPort`.
- `UPDATE: packages/sdk/src/types/agent.ts` - `Start.computers?: ComputerPort`.
- `UPDATE: packages/sdk/src/types/plugin.ts` - `registerComputers(port: ComputerPort): void`.
- `UPDATE: packages/sdk/src/plugins.ts` - the registration and the duplicate check every singleton port gets.
- `UPDATE: packages/sdk/src/host.ts` - pass the port through to the `Start` it builds.
- `UPDATE: packages/computer/src/plugin.ts` - build the port over the runtime and register it.
- `UPDATE: test/plugin-host.test.ts` - the registration and the duplicate.

## Steps

1. Declare the port beside the other ports, with the contract that it answers how and does not run anything itself.
2. Have the computer plugin answer `how('box', { command, args, cwd })` as the runtime's own exec prefix and the machine's workdir, and answer undefined with a sentence when the machine is not there.
3. Register the port through `registerComputers`, and refuse a second one the way a singleton port is refused.
4. Pass it into `Start` only when the host holds one, so a host without the computer plugin hands a backend nothing and the backend's own refusal is the honest answer.
5. Keep the environment out of the descriptor by default: the machine gets `-e` for what a caller explicitly names, not the daemon's whole environment.

## Validation

- `test/plugin-host.test.ts` - a plugin registers the port and it lands on `HostOptions`; a second registration is refused; a host with none hands a backend nothing.
- `test/computer.test.ts` - `how` answers the descriptor for a machine that is there and a sentence for one that is not, against the fixture runtime.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green, with `@ahpd/computer`'s declared dependencies unchanged.

## Resume

Not started.
A port rather than a package: no backend imports `@ahpd/computer`, and the boundary script is what says so.
