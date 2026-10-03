---
title: A connection is told who it is signed in as
domain: host
status: built
priority: high
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/36-people-are-resources-a-client-manages/plan.md
changes: []
creates: []
decisions:
  - decisions/a-connection-is-told-who-it-is-on-initialize-and-in-root-state.md
refs:
  - "[code://packages/sdk/src/host.ts#L4507-L4511](../../../../packages/sdk/src/host.ts#L4507-L4511) - `ownerFor`, the value both answers carry"
  - "[code://packages/sdk/src/host.ts#L7119-L7128](../../../../packages/sdk/src/host.ts#L7119-L7128) - `accept`, where a connection arrives with a principal or as root"
  - "[code://packages/sdk/src/host.ts#L7527-L7660](../../../../packages/sdk/src/host.ts#L7527-L7660) - `initialize` and the `_meta` it answers"
  - "[code://packages/sdk/src/host.ts#L6131-L6150](../../../../packages/sdk/src/host.ts#L6131-L6150) - `rootState(mine, connection)`, the per-connection snapshot and its `_meta`"
  - "[code://tools/wire.mjs#L167-L180](../../../../tools/wire.mjs#L167-L180) - `checker.frame()`, which routes subscribe snapshots to the schema"
  - "[code://packages/sdk/test/wire.test.ts](../../../../packages/sdk/test/wire.test.ts) - the gate that closes every object the host sends against the protocol schema"
  - "[code://docs/USERS.md](../../../../docs/USERS.md) - where a client is told how to read its own record"
---

## Goal

A client such as ahpapp knows which person it is on a host, so it can read that person's own `user://<id>` and mark their record.
Today the host knows (`connection.principal`, `connection.root`) and never says.

## Reconnaissance

### Runtime path

```
accept(peer, principal?, root?) -> initialize -> _meta (no principal today)
authenticate(person's resource) -> connection.principal = held -> {}
subscribe(ahp-root://) -> rootState(mine, connection) -> _meta (no principal today)
```

### Gaps

- `initialize`'s `_meta` names no principal.
- The root state snapshot's `_meta` names no principal, so a client that signs in later cannot learn who it became.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A connection is told who it is, on initialize and in its root state snapshot](../../../decisions/a-connection-is-told-who-it-is-on-initialize-and-in-root-state.md) | Softov, 2026-10-03 |

| What | Source | Task |
| --- | --- | --- |
| The key is `ahpd.principal`, the value `ownerFor(connection)`, absent when that is undefined | decision above | 01 |
| `authenticate` answers `{}` unchanged; the protocol declares its result empty | `@microsoft/agent-host-protocol@0.9.0` `AuthenticateResult`, found by the first build on 2026-10-03 | 01 |
| The wire fixture takes a root snapshot on a personal-token connection, so the key is checked by the schema gate | (defaulted: `checker.frame()` routes subscribe snapshots and never an authenticate result) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Initialize and sign-in say who](task-01-initialize-and-sign-in-say-who.md) | done | - |
| [02 - The docs say how a client learns who it is](task-02-the-docs-say-how-a-client-learns-who-it-is.md) | done | 01 |

## Risks and tradeoffs

- A client that signs in after connecting must take the root snapshot again to learn who it became - the docs say so, and ahpapp people/01 does it after its sign-in.

## Resume state

- **Done so far:** built 2026-10-03, see [implemented.md](implemented.md).

## Final verification checklist

- [x] A connection on a personal token gets `_meta['ahpd.principal']: "user:<id>"` from `initialize`.
- [x] A root connection gets `"root:<host>"`; a host with no users directory sends no key.
- [x] The root snapshot taken after a person signs in carries `user:<id>`; `authenticate` still answers `{}`.
- [x] The wire test passes with the new key in its fixture.
- [x] `plans/index.md` updated.
