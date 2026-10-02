---
title: A machine records who created it and writes the time it was up, charged to its owner - implemented
date: 2026-10-02
refs:
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts)"
  - "[code://packages/computer/src/owners.ts](../../../../packages/computer/src/owners.ts)"
  - "[code://packages/sdk/src/plugins.ts](../../../../packages/sdk/src/plugins.ts)"
---

Every machine the computer plugin makes, a reopen-in-container relay's included, knows who created it, and every stretch it is up is written as a `ComputerTime` record charged to that owner's, team's and project's pools, or to `root:<host>` for a machine with no owner.

## What was built

- `MachineSource` gains `owner`, `team` and `project`; the host fills them in `placedIn` from the session (client create, automation, restart before the first turn), and a direct `computer://` write passes the connection's owner as `ResourceStore.write`'s new third argument.
- `ContainerConnect.owner`, filled by the host from the connecting connection.
- [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts) - `ahpd.owner`, `ahpd.team`, `ahpd.project` labels on a `docker run` machine, read back by `claimedBy`, and `isRunning`.
- [`code://packages/computer/src/owners.ts`](../../../../packages/computer/src/owners.ts) - `computers.json` in the config folder, the owner of a machine the Dev Container CLI made, written at create or relay connect (the first creator pays) and removed with the machine.
- `PluginHost.recordUsage`, resolved against the folded host's `usage` port when called, and `PluginContext.hostName` and `configDir`.
- [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) - the runtime wrapped so run, start, restart, stop and remove open and close stretches, the relay's `connect` wrapped to record its owner and open one, running machines opened at start, open stretches closed on `stopping`.
- `docs/PLUGINS.md` - `recordUsage`, `registerUsage`, `hostName`, `configDir`.

## Verified

- `packages/sdk/test/machine-owner.test.ts`: a session-made machine's source carries the session's owner and scope; a direct create carries the connection's owner.
- `packages/computer/test/computer-owner.test.ts`: labels on a `docker run` machine and read back; a dev container goes up with folder id-labels only and its owner lands in `computers.json`, gone after removal.
- `packages/computer/test/computer-uptime.test.ts`: create then stop writes one record with exact `at` and `seconds`; a running machine at start is opened and a stopped one is not; an unowned machine is `root:<host>`; `stopping` closes every stretch; a relay connect records its owner and its stop is charged to them; no usage port writes nothing.
- `pnpm exec tsc --noEmit` clean; `pnpm test` 143 files, 2095 tests passed; `pnpm boundary` clean.

## Departures from the plan

- A machine the Dev Container CLI made keeps its owner in `computers.json`, not a label - decision [a-dev-container-owner-is-kept-beside-the-config](../../../decisions/a-dev-container-owner-is-kept-beside-the-config.md).
- The relay's containers are owned and metered - decision [a-relay-container-is-owned-by-who-connected](../../../decisions/a-relay-container-is-owned-by-who-connected.md).
- The labels and the owner file live in `runtime.ts` and `owners.ts`, not `devcontainer.ts`, which `runtime.ts` imports.
- `seconds` keeps milliseconds, so a machine up under a second is not zero.

## Left for later

- A crash loses the open stretch, and a machine stopped outside ahpd stays open - see [deferred.md](deferred.md).
