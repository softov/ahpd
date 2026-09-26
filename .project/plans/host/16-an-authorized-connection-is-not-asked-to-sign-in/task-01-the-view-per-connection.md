---
title: The root state tells an authorized connection sign-in is not required
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L2219-L2226](../../../../packages/sdk/src/host.ts#L2219-L2226) - `resourcesOf` and `loginId`, which name the resource to rewrite"
  - "[code://packages/sdk/src/host.ts#L1368-L1395](../../../../packages/sdk/src/host.ts#L1368-L1395) - `seenBy`, which the live and both replay paths already call"
  - "[code://packages/sdk/src/host.ts#L4219-L4222](../../../../packages/sdk/src/host.ts#L4219-L4222) - the snapshot path"
---

## Objective

Every copy of the root state's `agents` that reaches a root or signed-in connection lists the host's sign-in resource with `required: false`, and every other connection still reads `true`.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `agentsFor(connection, agents)` beside `resourcesOf`; applied in `snapshotOf` for the root and in a `root/agentsChanged` branch of `seenBy`.
- `UPDATE: test/users-host.test.ts` - the new cases.

## Steps

1. Write `agentsFor`: when `options.users` is set and the connection is root or has a principal, return a copy of `agents` where the entry with `resource === loginId()` has `required: false`; otherwise return `agents` as it is.
2. `snapshotOf(channel, mine)` for the root: pass the connection (or an `authorized` flag) alongside `mine`, and apply `agentsFor` to `state.agents`. Update the four callers.
3. `seenBy`: add a `root/agentsChanged` branch that returns the envelope with `action.agents` passed through `agentsFor`. The live broadcast, the reconnect replay and the subscribe replay already call `seenBy`, so they need no change.
4. Confirm with `grep -n "descriptors()" packages/sdk/src/host.ts` that no other path sends `agents`.

## Validation

- `test/users-host.test.ts`, on a host with a users directory:
  - root connection: the root snapshot has the sign-in resource at `required: false`.
  - personal-token connection before `authenticate`: `required: true`.
  - after `authenticate`: the next snapshot says `false`.
  - a live `root/agentsChanged` delivered to both connections carries each one's own value.
  - a reconnect replay to the root connection carries `false`.
  - a backend's own resource and GitHub's keep their `required` untouched.
- A host with no users directory sends the same `agents` to everyone.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` green, `test/conformance.test.ts` unchanged.

## Resume

Implemented 2026-09-26 in `packages/sdk/src/host.ts`: `agentsFor` beside `resourcesOf`, `rootState`/`snapshotOf` taking the connection, and a `root/agentsChanged` branch of `seenBy`.
`test/users-host.test.ts` has six new cases, one per line of *Validation*: the root snapshot, a personal connection before and after `authenticate`, a live dispatch to both connections, a reconnect replay, the untouched backend and GitHub resources, and a host with no directory.
`pnpm test` (1122 tests), `pnpm typecheck` and `pnpm boundary` are green, and `test/conformance.test.ts` is unchanged.

