---
title: The plugin docs describe connect and grants
status: todo
depends: [task-02-the-connection-is-the-plugins-principal.md]
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md#L171-L184](../../../../docs/PLUGINS.md#L171-L184) - Read-only context, beside which `connect` is described"
  - "[code://docs/PLUGINS.md#L282-L308](../../../../docs/PLUGINS.md#L282-L308) - the configuration entry, which gains `grants`"
---

## Objective

`docs/PLUGINS.md` says how a plugin acts on sessions, when it may connect, and what `grants` it needs.

## Files

- `UPDATE: docs/PLUGINS.md:171-184` - a short section on `connect()`, with a ten-line example that starts a session.
- `UPDATE: docs/PLUGINS.md:282-308` - `grants` in the object form, and that none is the default.

## Steps

1. One sentence per line, and link decision `a-grant-is-a-subject-and-a-verb` for the grammar.

## Validation

- The example runs against a daemon by hand.

## Resume

