---
title: A stored value the schema refuses falls back to the default
status: done
depends: [task-01-the-store-keeps-every-change.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L196-L200](../../../../packages/sdk/src/host/chatactions.ts#L196-L200) - resume"
  - "[code://packages/sdk/src/host/snapshots.ts#L396-L399](../../../../packages/sdk/src/host/snapshots.ts#L396-L399) - a browsed row"
---

## Objective

Before a resume or a browsed row uses a stored config, each value of a key the backend's current schema declares is checked against that property; a value it refuses is left out so the default applies, and the host logs one line naming the session, the key and the value.
A key the schema does not declare is kept and handed back, since the store only holds keys the backend accepted.

## Files

- `UPDATE: packages/sdk/src/host.ts` - one `storedConfig(owner, id)` used at 5530 and 8431.
- `UPDATE:` the host tests.

## Steps

1. Tests first: a stored `permissionMode: 'nope'` resumes with the default; a stored key the schema does not declare is passed as stored; a valid value is passed as stored.
2. The sdk has no schema checker and takes no dependency for one: check what a session property can say, `enum` membership and the JSON `type`, in a small function beside `validate.ts`.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

`storedConfig(owner, id)` in `host.ts` reads the stored config and keeps each value its property in `sessionSchema(owner)` accepts, backend and plugin keys both; the resume and the browsed row both read through it.
A key no property declares is kept, since a backend takes some without declaring them, such as Claude's `model` or a client's `mode`.
A declared key whose value its property refuses is left out and logged as `<session>: stored <key> <value> is not offered; using the default`, once per session, key and value for the host's lifetime, so a browsed row read again says nothing more.
The check is `accepts(property, value)` in a new `packages/sdk/src/configvalues.ts`: the JSON `type` (one or a list, an integer counting as a number) and `enum` membership, with an `enumDynamic` list not held to its listed values since it is only the first page.
Tests: `host-sessionconfig.test.ts`, `a session's config across a restart`, a stored `permissionMode: nope` resumes as `default` beside a stored `thinking: disabled` that is passed, with one log line; `keeps a stored key the schema does not declare, and drops a declared one it refuses, saying so once`: a browsed row read twice keeps `model: opus` and a valid `sandboxEnabled`, shows the default `permissions` in place of a stored `all`, and logs that once.
`configvalues.test.ts` covers the checker on its own; it was written with the module, after the two host cases had failed first (`nope` reached the CLI, and `gone` was in the row's values).
The earlier cut left out every undeclared key and logged a browsed row's drops on every read; that test was replaced by the one above, which failed first on the missing `model` and on two log lines.
