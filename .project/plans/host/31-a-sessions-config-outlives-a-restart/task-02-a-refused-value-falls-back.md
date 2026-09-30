---
title: A stored value the schema refuses falls back to the default
status: todo
depends: [task-01-the-store-keeps-every-change.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L8431](../../../../packages/sdk/src/host.ts#L8431) - resume"
  - "[code://packages/sdk/src/host.ts#L5530](../../../../packages/sdk/src/host.ts#L5530) - a browsed row"
---

## Objective

Before a resume or a browsed row uses a stored config, each value is checked against the backend's current schema property; a value it refuses, or a key it no longer declares, is left out so the default applies, and the host logs one line naming the session, the key and the value.

## Files

- `UPDATE: packages/sdk/src/host.ts` - one `storedConfig(owner, id)` used at 5530 and 8431.
- `UPDATE:` the host tests.

## Steps

1. Tests first: a stored `permissionMode: 'nope'` resumes with the default; a stored key the schema dropped is not passed; a valid value is passed as stored.
2. The sdk has no schema checker and takes no dependency for one: check what a session property can say, `enum` membership and the JSON `type`, in a small function beside `validate.ts`.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
