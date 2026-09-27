---
title: A served config answers from the daemon's own file, hides its secrets, or says it is gone
status: done
depends: [task-08-served-commands-act-on-the-daemons-own-options.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/config.ts#L15-L36](../../../../packages/server/src/commands/config.ts#L15-L36) - `withoutSecrets`, which masks the token and every plugin option value"
  - "[code://packages/server/src/commands/config.ts#L46-L62](../../../../packages/server/src/commands/config.ts#L46-L62) - the handler: a served request reads `served.configFile`, and a file that is gone answers under that path"
---

## Objective

`GET /api/config` never shows one file's contents under another file's path, with the daemon's configuration file gone answering the daemon's path with nothing set; and it masks every plugin option value, per decision [the-config-command-hides-its-secrets](../../../decisions/the-config-command-hides-its-secrets.md).

## Files

- `UPDATE: packages/server/src/commands/config.ts:15-36` - `withoutToken` becomes the mask for the token and each plugin entry's `options` values, with its comment naming the new decision.
- `UPDATE: packages/server/src/commands/config.ts:46-62` - the served branch.
- `UPDATE: packages/server/test/server-http.test.ts` - the case below.

## Steps

1. Served, the handler reads `served.configFile` and nothing else: when it exists, `loadConfig(served.configFile)`; when it does not, an empty configuration under that path.
2. The served answer masks `connectionToken` as `<set>`, and for each `plugins` entry that is an object with `options`, keeps the keys and replaces every value with `<set>`; a string entry is answered as it is.
3. The terminal branch keeps its behaviour.

## Validation

- `server-http.test.ts`: a daemon started with `--config-file <tmp>/a.json` and an `XDG_CONFIG_HOME` whose `ahpd/config.json` sets `"port": 1234`; delete `a.json`, then `GET /api/config` answers `path` `<tmp>/a.json` and a `config` with no `port`. Today it shows `port: 1234`.
- `server-http.test.ts`: a daemon whose file lists `{ "name": "<plugin>", "options": { "apiKey": "k1", "region": "eu" } }` answers that entry with `options` `{ "apiKey": "<set>", "region": "<set>" }`, and the body contains neither `k1` nor `eu`. Today it contains both.
- `node_modules/.bin/vitest run packages/server/test/server-http.test.ts` green.

## Resume

Seen to fail first: with the daemon's own configuration file deleted, `GET /api/config` answered `port: 1234` from the `XDG_CONFIG_HOME` default where it wanted the daemon's path and no port; and a served answer whose file listed a plugin with `options: { apiKey: "k1", region: "eu" }` contained both `k1` and `eu` where it wanted `<set>` twice. Both pass after the change.

Done: the served branch reads `served.configFile` and nothing else, answering `{}` under that path when the file is gone, and the terminal branch still has `loadConfig` refuse a `--config-file` that names nothing. `withoutToken` is now `withoutSecrets`: it masks `connectionToken` and, for every plugin entry that is an object with `options`, keeps the keys and replaces every value with `<set>`, leaving a string entry alone. Its comment names [the-config-command-hides-its-secrets](../../../decisions/the-config-command-hides-its-secrets.md).
