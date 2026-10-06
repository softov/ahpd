---
title: A verb declares only the flags it reads - implemented
date: 2026-10-06
refs:
  - "[code://packages/server/src/commands/options.ts#L462-L603](../../../../packages/server/src/commands/options.ts#L462-L603)"
  - "[code://packages/server/src/commands/user.ts#L102-L110](../../../../packages/server/src/commands/user.ts#L102-L110)"
  - "[code://packages/server/src/commands/teams.ts#L36-L41](../../../../packages/server/src/commands/teams.ts#L36-L41)"
  - "[code://packages/server/src/commands/vault.ts#L138-L141](../../../../packages/server/src/commands/vault.ts#L138-L141)"
---

Each `user`, `team`, `project` and `vault` verb now declares only the flags its own body reads, so its help, its `/api` form and `/api/cli-manifest` offer nothing it ignores, and a flag it never read is refused by name rather than accepted and dropped.

## What was built

- [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts) - `userFields` is gone, split into `userAt` (the file and the address: `configFile`, `users`, `host`, `port`), `userAddFields` (`userAt` plus `issuer`, `role` and the shared `recordFields`: `membership`, `primary`) and `userTokenFields` (`userAt` plus `url`); `userPrimaryFields` is now `userAt` plus its own `unset`. `teamFields` splits the same way into `teamAt` (`configFile`, `users`) and `title`, and the vault gets `vaultAt` (`configFile`) in place of the `flagFields` it used to spread. `servedUserFields` becomes `servedUserAddFields`, `servedUserTokenFields`, `servedUserPrimaryFields` and `servedTeamFields`, each a projection of the same field objects, so the served and the line sets cannot drift. `flagFields` and `serverFields` are untouched, and still carry start, stop, status, config, proxy, plugin, run and usage.
- [`code://packages/server/src/commands/user.ts`](../../../../packages/server/src/commands/user.ts) - the verb factory binds four sets: `at` (which is `userAt`, or nothing when served), `whole` (`userAddFields` / `servedUserAddFields`), `showing` (`userTokenFields` / `servedUserTokenFields`) and `unsetting` (`userPrimaryFields` / `servedUserPrimaryFields`). `user list` takes `at` alone, `user add` spreads `whole`, `user rm` spreads `at`, `user token` spreads `showing`, `user member` spreads `at` plus its own `unset`, `user primary` spreads `unsetting`. The record fields `user member` writes are unchanged.
- [`code://packages/server/src/commands/teams.ts`](../../../../packages/server/src/commands/teams.ts) - `at` is `teamAt` (or nothing served) and `naming` is `teamFields` / `servedTeamFields`; `list` and `rm` spread `at`, `add` spreads `naming`. This covers `team` and `project` alike, since the six verbs come from one factory.
- [`code://packages/server/src/commands/vault.ts`](../../../../packages/server/src/commands/vault.ts) - `fields` is `vaultAt` on a line and nothing served, so all three vault verbs take `--config-file` and no other daemon flag. The served `value` on `vault.set` is still declared, since it is the HTTP body rather than a flag.
- [`code://packages/server/test/server-commands.test.ts`](../../../../packages/server/test/server-commands.test.ts) - two tests over the registry and over `manifestFrom(servedRegistry(...))`.
- [`code://packages/server/test/server-cli.test.ts`](../../../../packages/server/test/server-cli.test.ts) - four tests driving the real CLI, one about the refusal text and exit code, one per subject.

## Verified

- `pnpm exec tsc --noEmit` clean; `pnpm boundary` clean, eight packages, none undeclared; `pnpm test` 216 files and 3065 tests, all passing; `pnpm build` clean.
- `packages/server/test/server-commands.test.ts`: "offers each verb the flags it reads, and no others" reads `registry.find(id).options` and holds `user list`/`rm`/`member`/`primary` to the location flags, `user add` to the record plus `issuer` and `role`, `user token` to `url`, `team add` and `project add` to `title` while their `list` and `rm` refuse it, and every vault verb to `--config-file` alone. "publishes what a request may set, and never the daemon's own file or address" reads the served manifest and holds `user.rm`, `team.rm` and `project.rm` to `id`, `user.list` and `vault.list` to nothing, `user.add` to `id`, `issuer`, `membership`, `primary`, `role`, `user.token` to `id` and `url`, `user.member` to `entries`, `id` and `unset`, `team.add` to `id` and `title`, and `vault.set` to `name` and `value` - the file and the address appear in none of them.
- `packages/server/test/server-cli.test.ts`: "refuses a flag the verb reads by nothing, naming it" sees `ahpd user rm ada --role admin --users <file>` exit 2 with `Unknown option --role` while `user list` still answers; "takes --url on the verb that prints one, and on no other" sees `user token ada --url` print a `ws://` URL and `user rm ada --url` refused; "takes --title on the verb that names one, and refuses it where it is read by nothing" sees `team add backend --title Backend` name it and `team rm backend --title Backend` refused; "takes the configuration it reads and refuses the daemon flags it does not" sees `vault list --config-file <file>` list a referenced secret and `vault delete host:orders --port 9310` refused.

## Departures from the plan

- The plan left the vault's location set unnamed, saying only "a vault location set in place of `flagFields`", and task-03's objective mentions "the fields that say where the vault is and how it is unlocked". The conservative reading was taken: `vaultAt` is `configFile` alone, because that is the one flag any vault body reads, and no unlock flag exists in the code to declare. Only `vault list` reads it, through `loadConfig`; `vault set` and `vault delete` reach the vault through the configuration directory (`vaultPath()`), so `--config-file` is declared on all three for the shared-set reason the plan's decision gives, and two of them read it by nothing today.
- `user add` keeps `membership` and `primary` as part of its record set (task-01 said "the record"), and `user member` keeps its own inline `unset` with its own description rather than sharing `servedUserPrimaryFields`', since `user member`'s says "every membership" and `user primary`'s says "their primary".

## Left for later

- Declaring `effect` and `resource` on these commands, which the decision locks to the plan after the cofold release that adds them.
- `--config-file` on `vault set` and `vault delete`, which neither reads: taking it off them would need the vault to be opened by flag rather than by the configuration directory, which is a behaviour change and not this plan's.
