---
title: A changeset operation needs session:write as well as file:write
status: implemented
depends: [task-08-a-dispatch-into-a-session-needs-session-write.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L210](../../../../packages/sdk/src/host.ts#L210) - `NEEDS`, where `invokeChangesetOperation` asks only `file:write`"
  - "[code://packages/sdk/src/host.ts#L2609](../../../../packages/sdk/src/host.ts#L2609) - `changesetAt`, which places a changeset channel under its session"
  - "[code://packages/sdk/src/host.ts#L6437-L6488](../../../../packages/sdk/src/host.ts#L6437-L6488) - `capabilityFor`, the grants a method asks"
  - "[code://packages/sdk/src/host.ts#L7672](../../../../packages/sdk/src/host.ts#L7672) - the `invokeChangesetOperation` handler"
  - "[code://packages/sdk/test/operations.test.ts#L145](../../../../packages/sdk/test/operations.test.ts#L145) - the operation tests to keep passing"
---

## Objective

Running an operation on a session's changeset (`invokeChangesetOperation` on `<provider>:/<id>/changeset/<scope>`, under any spelling of the session) needs `session:write` as well as `file:write`.
Before this, `file:write` alone was enough, so a person with no grant on sessions could run operations on any session's changes.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `capabilityFor` asks `session:write` of `invokeChangesetOperation` on top of `file:write`.
- `UPDATE: packages/sdk/test/users-gate.test.ts` - the cases below.

## Steps

1. Tests first: a `file:write`-only person is refused `invokeChangesetOperation` on a session's changeset with `session:write`, under the held name and under the client's alias, and the operation never ran; a person with both grants runs it.
2. Ask `session:write` in `capabilityFor` for the method, the way `completions` asks its channel's read grant.

## Validation

- The new cases in `users-gate.test.ts` fail first and pass after; `operations.test.ts` still passes.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

`capabilityFor` in `host.ts` asks `file:write` and `session:write` of `invokeChangesetOperation`, whatever the channel, since a changeset is always a session's and the handler refuses any other channel.
`NEEDS` still lists the method under `file:write`, so it stays classified.
Test in `users-gate.test.ts`: `needs session:write as well as file:write to run an operation on a session's changeset, under either name`, where a `file:write`-only person is refused `-32009` naming `session:write` on `claude:/one/changeset/uncommitted` and on `ahp-session:/one/changeset/uncommitted` and the source's `invoke` is never called, and a person with both runs `commit` under both names.
It failed first under both names, each answered `{ message: 'did commit' }`, with the operation run.
`operations.test.ts` passes unchanged.
Gates: `pnpm typecheck` and `pnpm boundary` pass; full `pnpm test` twice from `/github/.worktrees/ahpd-sdk-2`, 126 files and 1930 tests passed each run.
