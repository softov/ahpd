---
title: The user verbs declare their own flags
status: todo
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L468-L563](../../../../packages/server/src/commands/options.ts#L468-L563) - `userFields`, `userAddFields`, `userPrimaryFields` and their served copies"
  - "[code://packages/server/src/commands/user.ts](../../../../packages/server/src/commands/user.ts) - the verbs"
---

## Objective

`user list`, `rm`, `member` and `primary` take where the file is and their own fields only, `user add` also takes `issuer`, `role` and the record, and `user token` also takes `url`.

## Files

- `UPDATE: packages/server/src/commands/options.ts:468-563` - a location set (`configFile`, `users`, `host`, `port`), with `issuer` and `role` moved to the add set and `url` to a token set; the served sets split the same way.
- `UPDATE: packages/server/src/commands/user.ts` - each verb spreads the set it reads.

## Steps

1. Read each verb's `run` for the fields it reads, and declare exactly those.
2. Keep the served sets free of the file and the address.

## Validation

- Written first and seen failing: the line form of `user rm` refuses `--role`, naming it; the served manifest's `user.rm` input is `id` alone; `user token` still takes `--url`; `user add` still takes `--issuer` and `--role`.
- The existing user command tests stay green.
