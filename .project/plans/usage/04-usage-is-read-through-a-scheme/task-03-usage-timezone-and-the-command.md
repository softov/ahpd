---
title: The daemon reads `usage.timezone` and `ahpd usage` prints what a pool has spent
status: todo
depends: [task-02-the-usage-scheme.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L227-L233](../../../../packages/server/src/commands/options.ts#L227-L233) - the `usage` field, where `timezone` joins `per`"
  - "[code://packages/server/src/commands/user.ts#L53-L80](../../../../packages/server/src/commands/user.ts#L53-L80) - `people`, how a command reads the daemon's own store served and the local one from the terminal"
  - "[code://packages/server/src/commands/user.ts#L34-L41](../../../../packages/server/src/commands/user.ts#L34-L41) - `bounded`, the in-body check `user.primary` declares empty scopes for"
  - "[code://packages/server/src/commands/served.ts#L41-L72](../../../../packages/server/src/commands/served.ts#L41-L72) - `ServedFacts` and the registry a daemon serves"
  - "[code://packages/server/test/proxy-list.test.ts](../../../../packages/server/test/proxy-list.test.ts) - one command run at the terminal and under `/api`, the harness to copy"
---

## Objective

`usage.timezone` in the configuration says the zone a day and a week start in, and `ahpd usage [pool]` prints the same totals the scheme serves, declared once and rendered as the CLI and `/api`.

## Files

- `UPDATE: packages/server/src/commands/options.ts:56-63` - `usageTimezone` on `Options`, beside `usagePer`.
- `UPDATE: packages/server/src/commands/options.ts:227-233` - `timezone` in the `usage` field's properties, beside `per`; `usage` is already file-only at `:276`, so the key takes no flag.
- `UPDATE: packages/server/src/commands/options.ts:589` - the read, beside `usagePer`.
- `CREATE: packages/server/src/commands/usage.ts` - `declareUsage(registry, served?)`.
- `UPDATE: packages/server/src/commands/served.ts:41-59` - `ServedFacts` gains the daemon's usage port.
- `UPDATE: packages/server/src/commands/served.ts:62-72` and `packages/server/src/commands/registry.ts:50-63` - the one declaration in both registries.
- `UPDATE: packages/server/src/commands/run.ts:211-233` - `facts` gains the port; `:263-384` - the store is built once and shared with `base`; `:413-446` - the folded store is the one a served call reads.
- `CREATE: packages/server/test/usage-command.test.ts` - the cases below.
- `UPDATE: packages/server/test/config-check.test.ts:84-85` - the key beside the `usage.per` case.

## Steps

1. `usage.timezone` joins `per` in the `usage` field's properties as a string, so the configuration schema at `options.ts:311-317` checks it with no further work; a week that starts on the system's Monday day is what the key is for, which is why it has no flag beside the other daemon settings.
2. `Options.usageTimezone?: string` is read at `options.ts:589` beside `usagePer` and is absent when the file names none, which is what leaves the provider on the system's own zone.
3. The one `fileUsage` built inside `base` at `run.ts:357-360` is hoisted above `facts` at `:211-233`, so the store the provider is given and the store the command reads are one, and `facts.usage()` is rebound after `loadPlugins` at `:413` and `createHost` at `:445` to the folded port, the way `turning` is at `:446`: a plugin that registered its own store is the one a served `ahpd usage` answers from.
4. `declareUsage(registry, served?)` declares one `registry.action` with `cli: { pattern: ['usage', ':pool?'] }` and `http: { method: 'GET', path: '/usage/{pool}' }`, read with `context.optional<string>('pool')`, and it is called from both `cliRegistry()` and `servedRegistry()` so neither surface silently lacks it.
5. With no pool it lists the pools the caller may see, by calling the same answer `usage://` gives rather than a second copy of the rule; with one it prints that pool's `day`, `week` and `month` from the same `Usage.total` calls the provider makes, so the command and the scheme cannot drift.
6. `output(rows, text)` carries the numbers to `--json` the way `proxy.list` and `team.list` do, and the text is one line per period with the measures `total` reported, absent ones left out.
7. Served, `scopes` is `[]` and the body holds the caller with `bounded` (`packages/server/src/commands/user.ts:34-41`), the way `user.primary` does: `checkScopes` (`packages/server/src/commands/scopes.ts:37-47`) refuses anyone who does not hold the declared scopes, and a flat `usage:read` would refuse the very person the scheme serves their own pools to.
8. The zone is `served.options.usageTimezone` served, and the configuration this process reads from the terminal, as `people` reads the users file, so no flag and no request can name another store.
9. **Depends on open question 3 below:** what the daemon does with a `usage.timezone` no runtime on this host can resolve.

## Validation

- `packages/server/test/usage-command.test.ts`, new, shaped as `packages/server/test/proxy-list.test.ts` runs a command twice: at the terminal through `cliRegistry()`, and under `/api` through `servedRegistry(facts)` and `apiHandler`. It holds: `ahpd usage` lists the pools the caller may see; `ahpd usage user:ana` prints that pool's three totals and `--json` carries the same numbers; a person with a token sees their own, their teams' and their projects' pools over `/api` with no `usage:read` and is refused another's with 403 and `may not usage:read here`; the deployment token sees every pool; the day's, week's and month's totals equal the sum of the records `usage://<pool>/records` answers over the same range.
- `packages/server/test/config-check.test.ts`, beside `:84-85`: `usage.timezone` is taken as a string and refused when it is not one, and `usage` still holds no flag at `:200-202`.
- A case with `usage.timezone` naming a zone whose week does not start on the system's Monday day, proving the week boundary is the configured one and not the system's.
- `pnpm exec vitest run packages/server/test/usage-command.test.ts packages/server/test/config-check.test.ts packages/server/test/server-commands.test.ts`.
- `pnpm typecheck`, `pnpm test`, `pnpm boundary`.

## Resume
