---
title: The changeset verbs that write are served without one too
status: todo
depends:
  - task-01-the-resource-writes-are-served.md
layer: host
refs:
  - code://packages/sdk/src/host.ts#L5354-L5363 - the comment that names four gates, rewritten to three
  - code://packages/sdk/src/host.ts#L5406 - the `offered.writes === true` gate, deleted
  - code://test/operations.test.ts#L163-L172 - the refusal case, replaced
  - code://test/operations.test.ts#L199-L204 - the case that opens by requesting a grant, simplified
  - code://docs/AHP.md#L87 - the `invokeChangesetOperation` row that owns "the write gate"
---

## Objective

A changeset operation that writes runs for a connected client with no `resourceRequest` first, so a window's revert, stage or commit button is not refused on the same gate task 01 removed from the resource half.

## Files

- `UPDATE: packages/sdk/src/host.ts:5406` - delete the `if (offered.writes === true) needsWrite(...)` line.
- `UPDATE: packages/sdk/src/host.ts:5354-5363` - the comment above `invokeChangesetOperation` names three gates instead of four.
- `UPDATE: test/operations.test.ts:163-172` - the refusal case becomes one where the same `commit` runs.
- `UPDATE: test/operations.test.ts:199-204` - the `resourceRequest` call that opened the case goes, since nothing needs it.
- `UPDATE: docs/AHP.md:87` - the row drops "and the write gate".

## Steps

1. Remove the `needsWrite` call at `:5406` and the `offered.writes` test that guards it.
2. Rewrite the comment above `invokeChangesetOperation` so the three remaining gates are named: the offered id, the target kind, and the session not being mid-turn.
3. Update the two `test/operations.test.ts` cases, and leave `resourceRequest`'s own cases at `:183-197` in place.
4. Update `docs/AHP.md`'s row.
5. Run `pnpm test`, `pnpm typecheck` and `pnpm boundary`.

## Validation

- `test/operations.test.ts` - `commit` runs with no grant; the operation that writes nothing still runs; `resourceRequest` still answers a `file:` URI and still refuses a `virtual:` one.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- By hand: a window's changeset verb that writes is not refused `-32009`.

## Resume

Empty until started.
