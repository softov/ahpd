---
title: A served plugin list hides every plugin option value
status: todo
depends: [task-20-served-config-reads-the-daemons-file-or-says-it-is-gone.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/plugin.ts#L21-L41](../../../../packages/server/src/commands/plugin.ts#L21-L41) - `plugin list`, whose rows carry each spec with its `options`"
  - "[code://packages/server/src/commands/config.ts#L26-L36](../../../../packages/server/src/commands/config.ts#L26-L36) - `withoutSecrets`, the mask `config` uses"
---

## Objective

`GET /api/plugin/list`, which needs only `config:read`, never answers a plugin option value, per decision [the-config-command-hides-its-secrets](../../../decisions/the-config-command-hides-its-secrets.md); the terminal's `ahpd plugin list` keeps printing them.

## Files

- `UPDATE: packages/server/src/commands/config.ts:26-36` - the options mask is a function both commands use.
- `UPDATE: packages/server/src/commands/plugin.ts:21-41` - served rows are masked.
- `UPDATE: packages/server/test/server-http.test.ts` - the case below.

## Steps

1. Split the option mask out of `withoutSecrets` (keys kept, every value `<set>`) and export it.
2. Served, each row's spec `options` goes through it before the row is answered.

## Validation

- `server-http.test.ts`: a daemon whose file names a plugin with `options: { apiKey: 'SECRETKEY1' }`, asked `GET /api/plugin/list` by a person holding `config:read`, answers a body with no `SECRETKEY1` and the key `apiKey` as `<set>`. Today the value is in the body.
- `node_modules/.bin/vitest run packages/server/test/server-http.test.ts` green.

## Resume
