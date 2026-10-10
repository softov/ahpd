---
title: The docs read one key
status: done
depends: [task-01-ahpd-grants-holds-every-scheme.md]
layer: "docs"
refs:
  - "[code://docs/USERS.md#L369](../../../../docs/USERS.md#L369) - the paragraph on `ahpd.grants`"
  - "[code://docs/USERS.md#L517](../../../../docs/USERS.md#L517) - the line sending a client to `ahpd.grants.file` for a scheme's groups"
  - "[code://docs/PLUGINS.md#L308](../../../../docs/PLUGINS.md#L308) - the same, for a plugin's scheme"
---

## Objective

`USERS.md` and `PLUGINS.md` say `ahpd.grants` lists every subject a role can name, the schemes included, and no longer send a client to the `file` entry for a scheme's groups.

## Files

- `UPDATE: docs/USERS.md:369` - `ahpd.grants` holds the built-in subjects and every scheme this host serves.
- `UPDATE: docs/USERS.md:517` - a scheme's groups are on its own entry.
- `UPDATE: docs/PLUGINS.md:308` - a plugin's scheme appears in `ahpd.grants` under its own name.

## Steps

1. Rewrite the three passages; one paragraph per line, no em dashes.

## Validation

- Any test that reads `USERS.md` still passes: `pnpm test`.

## Resume

