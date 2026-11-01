---
title: The root holds its state
status: done
depends: [01]
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/root.ts#L563-L681](../../../../packages/sdk/src/host/root.ts#L563-L681) - the root state built per connection on each subscribe"
  - "[code://packages/sdk/src/host/actions.ts#L331-L394](../../../../packages/sdk/src/host/actions.ts#L331-L394) - a root config push, its `null` and its `replace`"
  - "[code://packages/sdk/src/host/catalogue.ts#L433-L438](../../../../packages/sdk/src/host/catalogue.ts#L433-L438) - `activeSessions` counts the running sessions"
  - "[code://packages/sdk/src/host.ts#L1209-L1213](../../../../packages/sdk/src/host.ts#L1209-L1213) - `ahpd.restartNeeded` set on root `_meta` with no action"
  - "[code://packages/sdk/src/host/terminals.ts#L350-L358](../../../../packages/sdk/src/host/terminals.ts#L350-L358) - a terminal's title and claim said on its own channel only"
---

## Objective

The root channel's agents, sessions, terminals and config are held as the root reducer makes them.
A subscribe reads them through the connection's own view, and nothing in them moves without a root action.

## Files

- `UPDATE: packages/sdk/src/host/root.ts` - `daemonValues`, `rootSeed`, `rootFor` and `keptOnReplace` in place of `rootState`; `_meta` built per connection without `ahpd.restartNeeded`.
- `UPDATE: packages/sdk/src/host/catalogue.ts` - `activeCount` counts the running sessions and the ones asleep.
- `UPDATE: packages/sdk/src/host/actions.ts` - a root config `replace` carries the values the root keeps.
- `UPDATE: packages/sdk/src/host.ts` - a terminal's title or claim moves the root's list.
- `UPDATE: packages/sdk/src/host/handshake.ts` - the handshake's `_meta` says `ahpd.restartNeeded`.
- `UPDATE: packages/sdk/src/types/host.ts` - `markRestartNeeded` and `RootConfigAnswer` say where the mark is read.

## Steps

1. Seed the root from every agent, the open sessions, the terminals and the whole config.
2. Read the root through `rootFor`: the agents the connection may use and the config keys it may read.
3. Count `activeSessions` over the running sessions and the ones asleep until disposed.
4. Send `root/terminalsChanged` when a terminal's title or claim moves the root's list.
5. Carry the daemon values and the accounts on a `replace` echo that names none of them.
6. Drop `ahpd.restartNeeded` from root `_meta`, and add it to the handshake's `_meta`.
7. Send `x-ahpd/restartNeeded` to a connection that subscribes to the root after the mark.

## Validation

- `pnpm exec vitest run packages/sdk/test/root-config.test.ts packages/sdk/test/root-account.test.ts packages/sdk/test/host-terminals.test.ts` passes.
- The root cases of the oracle pass.

## Resume

Done; [implemented.md](implemented.md) says what was built.
