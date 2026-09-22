---
title: A client may write a file it may read
domain: host
status: built
priority: high
created: 2026-09-23
revalidated: 2026-09-23
requires: []
changes: []
creates: []
decisions:
  - decisions/client-writes-are-served-not-gated.md
refs:
  - code://packages/sdk/src/host.ts#L4388-L4412 - `mayWrite` and `needsWrite`, the gate every write half calls
  - code://packages/sdk/src/host.ts#L4963-L4973 - the `resource*` comment that says the write half is gated
  - code://packages/sdk/src/host.ts#L5245-L5327 - the five resource handlers, and the comment that calls the grant the first of two gates
  - code://packages/sdk/src/host.ts#L5342-L5353 - `resourceRequest`, which grants any `file:` URI and is the only writer of `connection.grants`
  - code://packages/sdk/src/host.ts#L5406 - the same gate on a changeset operation that writes
  - code://test/writes.test.ts#L23-L37 - the `client(grant)` helper the write suite opens with
  - code://test/writes.test.ts#L242-L280 - the move and copy case whose far-end refusal is this gate
  - code://test/writes.test.ts#L282-L309 - the two cases that exist only to pin the gate
  - code://test/host.test.ts#L3375-L3395 - the host case that pins the refusal and its `data.request`
  - code://test/operations.test.ts#L163-L197 - the changeset refusal and the `resourceRequest` cases beside it
  - code://test/clients.test.ts#L200-L241 - the client-owned refusal, which is the owner's and stays
  - code://docs/AHP.md#L87-L96 - the three rows that describe the gate
  - code://README.md#L248 - the Resources row that says writes are behind `resourceRequest`
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1644-L1743 - the reference host, which serves `resourceWrite` and enforces no grant
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/agentHostFileSystemProvider.ts#L491-L560 - the client's save, and the ask it never makes
  - git://832cf23c5 - the VS Code revision the two files above were read at
---

## Goal

A client that has connected may write, delete, create, move and copy the files this host serves, with no grant to negotiate first, so a VS Code window can save in a session workspace.
`resourceRequest` stays served and keeps answering, and a resource owned by another client still answers with that client's own refusal.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "needsWrite|mayWrite" packages/sdk/src` - the gate is defined once at `host.ts:4388` and called at seven places: the five resource handlers and `invokeChangesetOperation`.
- `rg -n "connection.grants" packages/sdk/src` - written by `resourceRequest` at `:5349` and read only inside `mayWrite`; nothing else reads a grant.
- `rg -n "resourceRequest" /github/externals/vscode/src/vs/platform/agentHost` - `requestResourceAccess` has no production caller there, and the reference host's own handler enforces nothing.
- `rg -n "32009|refused" test/writes.test.ts test/host.test.ts test/operations.test.ts` - the cases that pin the gate, listed in the refs.
- `rg -n "resourceRequest" docs README.md` - three rows in `docs/AHP.md` and the Resources row in `README.md`.

### Runtime path

```
a client's resourceWrite | resourceDelete | resourceMkdir | resourceMove | resourceCopy
  -> needsWrite(uri)            <- the gate this plan removes
  -> need(options.resources, method) -> the store, which still refuses a symlink, a directory or a missing parent
invokeChangesetOperation with offered.writes === true
  -> needsWrite(target.resource)  <- the same gate, removed by task 02
  -> the changes port runs the verb
```

### Gaps

- `Not found: any production caller of requestResourceAccess - searched "requestResourceAccess" in /github/externals/vscode/src; only its definition and its own tests.`
- The store's `-32009` for a symlink, a directory or a missing parent is a different refusal from the gate's, and it stays; `test/resource-write.test.ts`'s shared fixture is about the store and does not move.
- `connection.grants` becomes unread once `mayWrite` goes, so removing the gate without removing the set would leave a claim of enforcement nothing performs.
- The read half was never gated, so a client may already list and read what it may not write, which is the asymmetry the reported symptom lands on.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A client that may connect may write a file it may read](../../../decisions/client-writes-are-served-not-gated.md) | The user chose "Plan it first" on 2026-09-23, so this file is the proposal under review. |

| What | Source | Task |
| --- | --- | --- |
| `resourceRequest` stays served, still answers `{}` for a `file:` URI and still logs the ask | (defaulted: the reference answers it, and an ask is worth a log line) | 01 |
| `mayWrite`, `needsWrite` and `connection.grants` go together | (defaulted: a set nothing reads claims enforcement that is not there) | 01 |
| A client-owned resource's `-32009` is relayed unchanged | (defaulted: the owner's refusal, not this host's gate) | 01 |
| The changeset verbs lose the same gate, because a revert or a stage writes too | decision 1 | 02 |
| The store's refusals for a symlink, a directory or a missing parent are untouched | (defaulted: they are about a path, not about a connection) | 01 |

## Proposed architecture

- **Data flow** - unchanged: each handler calls the store directly, as it does today once `needsWrite` returns.
- **Event flow** - unchanged: `resource_write` still fires after a write, and `resourceRequest` still writes its log line.
- **State flow** - `grants` leaves the connection shape at `host.ts:4298`; auth tokens and their `expiring` timers at `:4325-L4373` are untouched and unrelated.
- **Layer responsibilities** - packages/sdk: the gate, its callers and its comments · test/: the cases that pinned it, plus the client-owned relay that stays · docs: three rows in `docs/AHP.md` and one in `README.md`.
- **Source-of-truth files** - `code://packages/sdk/src/host.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The resource writes are served without a grant](task-01-the-resource-writes-are-served.md) | done | - |
| [02 - The changeset verbs that write are served without one too](task-02-the-changeset-verbs-are-served.md) | done | 01 |

## Risks and tradeoffs

- The change widens what a connected client may do, and the only thing left deciding is the connection boundary; a daemon that is not loopback needs `--connection-token`, which is what the decision record says.
- The move and copy case at `test/writes.test.ts:242` asserted the far-end refusal, and the store may still refuse a destination it cannot write; the case is rewritten to assert the move lands and keeps the copy `failIfExists` half rather than deleted.
- Leaving `invokeChangesetOperation` gated would keep a window's revert and stage buttons refused after the resource half was fixed, which is why task 02 is in the same plan and not a follow-up.
- The two `-32009`s now differ in origin (the owner's and the store's), and a reader who assumes one meaning for the code would be wrong; naming both in the code comments is the mitigation.

## Resume state

- **Done so far:** both tasks, 2026-09-23. `mayWrite`, `needsWrite` and `connection.grants` are gone, the five resource handlers and `invokeChangesetOperation` serve a write with no grant, and `resourceRequest` still answers and logs. See [implemented.md](implemented.md).
- **Next action:** none; the plan is built. What is left is the by-hand window check below and a version bump, since `0.6.2` is published.
- **Open questions:**
  1. Does the window ask for a read grant before it lists a directory? - answered: no, and it never needed to, because the read half was never gated.
- **Watch out for:** the two `-32009`s now differ in origin. The store's is about a path and the owner's relay is about someone else's resource; a reader who assumes one meaning for the code would be wrong.

## Final verification checklist

- [x] `pnpm test` green, with `test/writes.test.ts` and `test/operations.test.ts` updated.
- [x] `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- [x] By hand: a VS Code window saves a file in a session workspace this host serves. Confirmed by the user in a running window on 2026-09-23; the wire call had already been driven against the real daemon, see [implemented.md](implemented.md).
- [x] `plans/index.md` and [00-host.md](../00-host.md) updated.
