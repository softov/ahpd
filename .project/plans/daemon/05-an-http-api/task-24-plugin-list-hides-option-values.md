---
title: A served plugin list hides every plugin option value
status: implemented
depends: [task-20-served-config-reads-the-daemons-file-or-says-it-is-gone.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/plugin.ts#L22-L46](../../../../packages/server/src/commands/plugin.ts#L22-L46) - `plugin list`, whose rows carry each spec with its `options`"
  - "[code://packages/server/src/commands/config.ts#L40-L44](../../../../packages/server/src/commands/config.ts#L40-L44) - `withoutSecrets`, the mask `config` uses"
---

## Objective

`GET /api/plugin/list`, which needs only `config:read`, never answers a plugin option value, per decision [the-config-command-hides-its-secrets](../../../decisions/the-config-command-hides-its-secrets.md); the terminal's `ahpd plugin list` keeps printing them.

## Files

- `UPDATE: packages/server/src/commands/config.ts:40-44` - the options mask is a function both commands use.
- `UPDATE: packages/server/src/commands/plugin.ts:22-46` - served rows are masked.
- `UPDATE: packages/server/test/server-http.test.ts` - the case below.

## Steps

1. Split the option mask out of `withoutSecrets` (keys kept, every value `<set>`) and export it.
2. Served, each row's spec `options` goes through it before the row is answered.

## Validation

- `server-http.test.ts`: a daemon whose file names a plugin with `options: { apiKey: 'SECRETKEY1' }`, asked `GET /api/plugin/list` by a person holding `config:read`, answers a body with no `SECRETKEY1` and the key `apiKey` as `<set>`. Today the value is in the body.
- `node_modules/.bin/vitest run packages/server/test/server-http.test.ts` green.

## Resume

Implemented 2026-09-27. The case was written first: a person holding only `config:read` asked `GET /api/plugin/list` of a daemon whose file names a plugin with `options: { apiKey: 'SECRETKEY1' }`, and the body carried `SECRETKEY1`. `config.ts` exports `withoutOptionValues`, which `withoutSecrets` now maps over the plugins, and a served `plugin list` puts each row's `spec` through it; the terminal's listing is unchanged. The case passes with `apiKey: '<set>'`, and `server-http.test.ts` is green (50). `docs/DAEMON.md` says `GET /api/plugin/list` masks the options as `config` does.
