---
title: A session picks its scope
status: todo
depends: [task-02-resolve.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/host.ts#L218](../../../../packages/sdk/src/types/host.ts#L218) - `sessionConfig`"
---

## Objective

Under a users directory, a session offers a `scope` key whose choices are the asking person's memberships, preset to their primary, fixed after the first turn as [host 18](../18-a-provisional-session-takes-any-key/plan.md) fixes a computer; the resolved scope is kept with the session.

## Files

- `UPDATE: packages/sdk/src/host.ts` - the `scope` key, its completions from the principal, resolved by `scopeFor` at the first turn; a refusal fails the turn with the list.
- `UPDATE: packages/sdk/src/sessions.ts` - the resolved scope persisted beside the owner (host 34).

## Steps

1. `team:*` offers one choice per known project of that team.

## Validation

- A host test: the picker lists the person's memberships, defaults to the primary, refuses a change after the first turn, and survives a reload.
- `pnpm -F @ahpd/sdk test`.

## Resume
