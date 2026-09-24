---
title: A record's provider from the command line
status: done
depends: []
layer: packages/sdk, packages/server
refs:
  - "[code://packages/sdk/src/users.ts#L470-L505](../../../../packages/sdk/src/users.ts#L470-L505) - `add`, which sets or leaves the issuer"
  - "[code://packages/sdk/src/types/users.ts#L190-L192](../../../../packages/sdk/src/types/users.ts#L190-L192) - the `Users.add` signature"
  - "[code://packages/server/src/main.ts#L475-L545](../../../../packages/server/src/main.ts#L475-L545) - the `user` verb's flags and its `add`"
  - "[code://test/users-issuer.test.ts](../../../../test/users-issuer.test.ts) - the case"
---

## Objective

`ahpd user add <id> --role <name> --issuer <github|url>` writes the provider onto the record, an issuer nothing can resolve is refused with a sentence, and adding a role without naming an issuer does not move somebody to the host's default.

## Files

- `UPDATE: packages/sdk/src/types/users.ts` - `add(id, roles, options?)`.
- `UPDATE: packages/sdk/src/users.ts` - `knows(name)`, and `add` setting the issuer on a new record and on one that already exists.
- `UPDATE: packages/server/src/main.ts` - `--issuer` in the `user` verb, passed to `add`, named in the confirmation and in the usage line.
- `UPDATE: test/users-issuer.test.ts` - set, refuse, and leave alone.

## Steps

1. Add the optional third argument to the port, so an existing caller is unaffected.
2. Resolve the name through the same resolver the file uses and refuse one that answers nothing, beside the unknown-role refusal.
3. Set it on a new record, and on an existing one only when the option is given.
4. Parse `--issuer` in the `user` verb and name the provider in what the verb prints.

## Validation

- `test/users-issuer.test.ts` - a record added with an issuer lists with it; `add` without the option keeps the provider; an unresolvable name is refused with `no issuer called nope`.
- `pnpm typecheck` green, because the port changed and every caller is checked.

## Resume

Done 2026-09-23.
The CLI can set a record's provider, and the SDK refuses a name that nothing can resolve.
