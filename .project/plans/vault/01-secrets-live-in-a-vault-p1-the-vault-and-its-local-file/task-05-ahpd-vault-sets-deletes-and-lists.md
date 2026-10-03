---
title: ahpd vault sets, deletes and lists
status: done
depends: [task-08-the-daemon-holds-its-vault.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/usage.ts#L22-L46](../../../../packages/server/src/commands/usage.ts#L22-L46) - `storeOf`: the daemon's store when served, the file at the terminal"
  - "[code://packages/server/src/commands/usage.ts#L85-L124](../../../../packages/server/src/commands/usage.ts#L85-L124) - `scopes: []` and a body that checks the caller"
  - "[code://packages/server/src/commands/teams.ts#L36-L95](../../../../packages/server/src/commands/teams.ts#L36-L95) - list, add and rm declared once for both surfaces"
  - "[code://packages/server/src/commands/user.ts#L34-L41](../../../../packages/server/src/commands/user.ts#L34-L41) - `bounded`, the caller held to grants inside a body"
  - "[code://packages/server/src/commands/registry.ts#L51-L66](../../../../packages/server/src/commands/registry.ts#L51-L66) - `cliRegistry`"
  - "[code://packages/server/src/commands/served.ts#L68-L80](../../../../packages/server/src/commands/served.ts#L68-L80) - `servedRegistry`"
  - "[code://packages/sdk/src/types/users.ts#L40-L81](../../../../packages/sdk/src/types/users.ts#L40-L81) - `Principal`: `id`, `can`, `memberships`"
  - "[code://packages/server/test/usage-command.test.ts](../../../../packages/server/test/usage-command.test.ts) - one command tested at the terminal and under `/api`"
---

## Objective

`ahpd vault set <name>`, `ahpd vault delete <name>` and `ahpd vault list` work at the terminal and under `/api/vault/...`, declared once each, and nothing they answer holds a value.

## Files

- `CREATE: packages/server/src/commands/vault.ts` - `declareVault(registry, served?)`, three actions.
- `UPDATE: packages/server/src/commands/registry.ts:51-66`, `packages/server/src/commands/served.ts:68-80` - `declareVault` in both registries.
- `CREATE: packages/server/test/vault-command.test.ts` - the cases below.

## Steps

1. `vaultOf(context, served)` mirrors `storeOf`: served, `served.vault()`; at the terminal, `fileVault({ file: vaultPath() })`.
2. `vault.set`: `cli: ['vault', 'set', ':name']`, `http: POST /vault/set/{name}`. At the terminal the value is standard input, read to its end with one trailing newline dropped, and refused with `pipe the value on standard input` when standard input is a terminal, so it is never echoed; the `value` field is declared only when served. The answer is `{ name, set: true }`.
3. `vault.delete`: `cli: ['vault', 'delete', ':name']`, `http: POST /vault/delete/{name}`; refused with `conflict` when the vault holds no such name.
4. `vault.list`: `cli: ['vault', 'list']`, `http: GET /vault/list`; rows `{ name, set }` for every name the vault holds and every `$secret` name `config.json` references that it does not, with where it is referenced; empty says `no secrets`.
5. Each action declares `scopes: []` and checks the caller in its body per the scope of the name, as `usage.list` does, in one function `mayWrite(principal, name)` and one `mayList(principal, name)`.
   `host:` needs `config:write` to write and `config:read` to list; `team:<team>/` needs `team:write` and a membership in that team; `user:<id>/` is only that person; root writes and lists any; no new subject.
   `list` keeps only the rows the caller may see.
6. A name in a URL path is one encoded segment, as a usage pool is, since it holds `:` and `/`.

## Validation

- `packages/server/test/vault-command.test.ts`: set at the terminal from standard input, then list shows it set and no value; set with standard input a terminal is refused; a name referenced in `config.json` and not held lists as not set; delete of a missing name is a conflict; served, a member without `config:write` is refused a `host:` set, a member of a team with `team:write` may set its `team:` name and is refused another team's, a person may set their own `user:` and is refused another's, root may set any, a caller with `config:read` lists `host:` names and one without does not; no response body contains the value.
- `pnpm -F @ahpd/server test`.

## Resume
