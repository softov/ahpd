---
title: ahpd proxy list
status: done
depends: [task-01-config.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/registry.ts#L48-L59](../../../../packages/server/src/commands/registry.ts#L48-L59) - the CLI registry"
  - "[code://packages/server/src/commands/served.ts#L60-L67](../../../../packages/server/src/commands/served.ts#L60-L67) - the `/api` registry"
---

## Objective

`ahpd proxy list` and `/api/proxy/list` show each provider (endpoint, accepts, whether its key is set) and each model name with its providers.

## Files

- `CREATE: packages/server/src/commands/proxy.ts` - the command, `config:read` scope.
- `UPDATE: packages/server/src/commands/registry.ts:48-59`, `packages/server/src/commands/served.ts:60-67` - register it.

## Steps

1. Never print a key's value.

## Validation

- A command test: the listing has the built-ins and a user provider, `key set: false` when the variable is missing.
- `pnpm -F @ahpd/server test`.

## Resume

- **Done so far:** 2026-10-01. `packages/server/src/commands/proxy.ts` declares `proxy.list` (`ahpd proxy list`, `GET /api/proxy/list`, `config:read`), registered in `cliRegistry` and `servedRegistry`. It reads `Options.proxy`, which is already the merged configuration, so the terminal reads the file through `optionsFrom` and the served one reads the daemon's own options. The answer is `{ providers, models }`, and the text is a `providers:` table with the id in a column, then one line per model name and one indented line per entry.
- **Next action:** nothing in this task.
- **Open questions:** none.
- **Watch out for:**
  - A key's value is never in the data to print: a row carries `key: { env }` and `keySet`, and `keySet` is `process.env[env] !== undefined`. The listing reads the environment and nothing else, so a served answer is the same as a terminal one and neither needs a redaction pass.
  - A provider with no `key` says `no key`, rather than `key set: false` naming no variable, and `keySet` is still in the JSON so a script does not have to read the line.
  - The line format is not a table of fixed columns past the id: the endpoint, the dialects and the key follow the widest id, so a long provider name moves its own row rather than every row.
  - The price is shown only when the entry has one, and only the halves it names: `$15 out per Mtok` is what a `price` holding only `output` says.
- **Tests:** `packages/server/test/proxy-list.test.ts` - the three built-ins and no models with no configuration; `key set: false` naming the variable when it is unset; a provider the file added with its model name and prices; a variable that is set says `key set: true` and neither the line nor the JSON holds its value; `GET /api/proxy/list` answers the daemon's own providers and model names. The first two unset the three built-in variables for the case, so the suite does not read the machine it runs on. `pnpm -F @ahpd/server test` and `pnpm test` pass.
