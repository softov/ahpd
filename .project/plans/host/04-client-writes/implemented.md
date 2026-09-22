---
title: A client may write a file it may read - implemented
date: 2026-09-22
refs:
  - code://packages/sdk/src/host.ts
  - code://packages/sdk/src/types/host.ts
  - code://packages/sdk/src/types/changes.ts
  - code://packages/sdk/src/changes.ts
  - code://test/writes.test.ts
  - code://test/host.test.ts
  - code://test/operations.test.ts
  - code://docs/AHP.md
  - code://README.md
---

A connected client may now write, delete, create, move and copy any file the store reaches, with no grant to negotiate first, so a VS Code window can save in a session workspace.
`resourceRequest` stays served and still answers yes for a `file:` URI, but it withholds nothing because nothing is withheld any more, and the same is true of a changeset operation that writes.
The store's own refusals and a client-owned resource's relayed refusal are untouched, so the only boundary left deciding a write is the connection itself.

## What was built

- `code://packages/sdk/src/host.ts` - `mayWrite` and `needsWrite` are deleted, the six calls to them are gone from the five resource handlers and from `invokeChangesetOperation`, and the comments at the `resource*` family, the write half and `resourceRequest` now name one gate, the store's.
- `code://packages/sdk/src/types/host.ts` - `Connection` no longer carries `grants`, so nothing holds a claim of enforcement.
- `code://packages/sdk/src/types/changes.ts` and `code://packages/sdk/src/changes.ts` - `ChangesetOperation.writes` stays as descriptive metadata, and the two comments that said the host gated on it now say what it is for.
- `code://test/writes.test.ts` - the helper loses its grant argument, the far-end move asserts it lands, and the two grant cases become one that a first write needs no grant and that `resourceRequest` still answers.
- `code://test/host.test.ts` - the refusal case becomes one that the same write succeeds, the read-only-store case no longer asks for a grant, and the `create-pr` helper opens with no request.
- `code://test/operations.test.ts` - `commit` runs with no grant, and the `resourceRequest` case says it answers rather than grants.
- `code://docs/AHP.md` and `code://README.md` - the resource, changeset and `resourceRequest` rows say what is true now.

## Verified

- `test/writes.test.ts` - 18 tests, two replaced by one and the sibling-prefix case dropped with the code that pinned it.
- `test/host.test.ts` - 280 tests, one replaced: a write to a fresh temporary directory answers `{}` and the file is on disk with nothing asked first.
- `test/operations.test.ts` - 15 tests, two updated: a write verb runs with no grant and still reports running then idle.
- `test/clients.test.ts` - unchanged and passing, which is the case that must not move: a client-owned resource's `-32009` is the owner's and is still relayed verbatim with its log line.
- `pnpm test` green: 63 files, 849 tests, the schema check included.
- `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- By hand, against the real daemon rather than an in-process host: `node packages/server/dist/main.js --no-plugins --port 0` was driven over its WebSocket with exactly the call `agentHostFileSystemProvider.writeFile` makes, a first `resourceWrite` with no `resourceRequest` before it. It answered `{}`, the bytes were on disk, `resourceMkdir`, `resourceMove` and `resourceDelete` all landed, and `resourceRequest` still answered `{}`.

## Departures from the plan

- `Connection.grants` had to go from `packages/sdk/src/types/host.ts` as well as from `packages/sdk/src/host.ts`, which the task's file list did not name: `mayWrite` was its only reader, so leaving the field would have been a claim of enforcement nothing performs.
- Two more comments outside the plan's list said the host gated on a write grant, in `packages/sdk/src/types/changes.ts` and `packages/sdk/src/changes.ts`; they were corrected with the rest. The `writes` flag itself stays, as the descriptive thing a client draws a destructive verb from.
- `test/operations.test.ts` changed in three places rather than two: the `resourceRequest` case's title and comment also said "grants", which was true then and is not now.

## Left for later

Nothing. The VS Code window check was confirmed by the user in a running window on 2026-09-22, and the release shipped as `0.6.3`.
