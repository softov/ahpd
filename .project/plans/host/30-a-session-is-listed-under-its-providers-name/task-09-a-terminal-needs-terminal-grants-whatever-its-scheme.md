---
title: A terminal needs terminal grants whatever its scheme
status: done
depends: [task-08-a-dispatch-into-a-session-needs-session-write.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/routing.ts#L337-L358](../../../../packages/sdk/src/host/routing.ts#L337-L358) - `channelKind`, which reads a terminal the host holds as a terminal"
  - "[code://packages/sdk/src/host/gate.ts#L159-L169](../../../../packages/sdk/src/host/gate.ts#L159-L169) - `dispatchNeeds`, which asks `terminal:write` of a terminal"
  - "[code://packages/sdk/src/host/admission.ts#L35-L49](../../../../packages/sdk/src/host/admission.ts#L35-L49) - `capabilityFor`, which asks `terminal:read` of a terminal"
  - "[code://packages/sdk/test/users-gate.test.ts#L917-L935](../../../../packages/sdk/test/users-gate.test.ts#L917-L935) - the test"
---

## Objective

A terminal the host holds needs `terminal:read` to subscribe and `terminal:write` to dispatch, whatever scheme the client created it under.
Before this, only `ahp-terminal:` was read as a terminal, so a `file:read` guest could subscribe to and type into VS Code's `agenthost-terminal:` shells.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `channelKind` answers `terminal` for any channel in `terminals`; `capabilityFor` and `dispatchNeeds` read the kind.
- `UPDATE: packages/sdk/test/users-gate.test.ts` - the case below.

## Steps

1. Test first: a terminal created as `agenthost-terminal:/probe`; a `file:read` guest is refused a subscribe with `terminal:read` and `terminal/input` with `terminal:write`, and the owner's shell never ran the guest's input.
2. Read a terminal in `terminals` as a terminal in both gates.

## Validation

- `needs terminal grants for a terminal this host holds, whatever its scheme` in `users-gate.test.ts` fails first and passes after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

`channelKind(channel)` answers `session`, `terminal` or `other`: `ahp-terminal:` and any name `claims` holds as a terminal are `terminal`; `terminals` is a `Claiming` map, so every terminal is claimed as it is made.
`capabilityFor` asks `terminal:read` of it, and `dispatchNeeds(channel, kind, action)` asks `terminal:write`.
Both gates take the grants of the channel as spelt and as resolved, so the stricter one is always asked.
The test failed first: the guest's subscribe was answered and its `terminal/input` reached the shell under `file:read`.
