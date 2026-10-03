---
title: A connection is told who it is signed in as
domain: host
status: planned
priority: high
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/36-people-are-resources-a-client-manages/plan.md
changes: []
creates: []
decisions:
  - decisions/a-connection-is-told-who-it-is.md
refs:
  - "[code://packages/sdk/src/host.ts#L4507-L4511](../../../../packages/sdk/src/host.ts#L4507-L4511) - `ownerFor`, the value both answers carry"
  - "[code://packages/sdk/src/host.ts#L7119-L7128](../../../../packages/sdk/src/host.ts#L7119-L7128) - `accept`, where a connection arrives with a principal or as root"
  - "[code://packages/sdk/src/host.ts#L7527-L7660](../../../../packages/sdk/src/host.ts#L7527-L7660) - `initialize` and the `_meta` it answers"
  - "[code://packages/sdk/src/host.ts#L8310-L8440](../../../../packages/sdk/src/host.ts#L8310-L8440) - `authenticate`, and the return after `connection.principal = held`"
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
authenticate(person's resource) -> connection.principal = held -> {} (nothing said)
```

### Gaps

- `initialize`'s `_meta` names no principal.
- The `authenticate` that signs a person in answers `{}`.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A connection is told who it is, on initialize and on the authenticate that signs it in](../../../decisions/a-connection-is-told-who-it-is.md) | Softov, 2026-10-03 |

| What | Source | Task |
| --- | --- | --- |
| The key is `ahpd.principal`, the value `ownerFor(connection)`, absent when that is undefined | decision above | 01 |
| `authenticate` carries it in `_meta` on its result only for the person's own sign-in resource; a backend or MCP token's `authenticate` answers as it does today | (defaulted: only that one changes who the connection is) | 01 |
| If the protocol schema does not allow `_meta` on an authenticate result, stop and ask rather than send it | (defaulted: `wire.test.ts` closes every object the host sends against the protocol schema) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Initialize and sign-in say who](task-01-initialize-and-sign-in-say-who.md) | todo | - |
| [02 - The docs say how a client learns who it is](task-02-the-docs-say-how-a-client-learns-who-it-is.md) | todo | 01 |

## Risks and tradeoffs

- A client that caches the handshake answer across a sign-in would show the old principal - the authenticate answer is the update, and the docs say so.

## Resume state

- **Done so far:** planned 2026-10-03.
- **Next action:** [task-01-initialize-and-sign-in-say-who.md](task-01-initialize-and-sign-in-say-who.md).
- **Open questions:** none.
- **Watch out for:** `initialize` is answered per connection, but the `_meta` block there is built inline; read the connection the same way the rest of that handler does rather than adding a parameter.

## Final verification checklist

- [ ] A connection on a personal token gets `_meta['ahpd.principal']: "user:<id>"` from `initialize`.
- [ ] A root connection gets `"root:<host>"`; a host with no users directory sends no key.
- [ ] The `authenticate` that signs a person in answers the key; another `authenticate` does not.
- [ ] The wire test passes with the new key in its fixture.
- [ ] `plans/index.md` updated.
