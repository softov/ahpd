---
title: Served answers hide the credentials in a plugin's URL
status: todo
depends: [task-24-plugin-list-hides-option-values.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/config.ts#L24-L44](../../../../packages/server/src/commands/config.ts#L24-L44) - `withoutOptionValues` and `withoutSecrets`, the served masks"
  - "[code://packages/server/src/commands/plugin.ts#L36-L43](../../../../packages/server/src/commands/plugin.ts#L36-L43) - a served `plugin list` row, masked with `withoutOptionValues`"
  - "[code://packages/server/src/plugins.ts#L579-L630](../../../../packages/server/src/plugins.ts#L579-L630) - `describePlugin`, whose row carries the spec, and a `problem` that can quote it"
  - "[code://packages/sdk/src/types/plugin.ts#L61-L68](../../../../packages/sdk/src/types/plugin.ts#L61-L68) - `PluginSpec`, a string or an object with `name`"
---

## Objective

`GET /api/config` and `GET /api/plugin/list` never answer the user and password of a plugin spec written as a URL (`git+https://user:pat@host/repo`), per decision [served-answers-hide-plugin-option-values-and-url-credentials](../../../decisions/served-answers-hide-plugin-option-values-and-url-credentials.md); the terminal's `ahpd config` and `ahpd plugin list` keep printing the file.

## Files

- `UPDATE: packages/server/src/commands/config.ts:24-44` - the served mask also replaces a URL's userinfo.
  The comment on `withoutOptionValues` names decision `the-config-command-hides-its-secrets`, which this one supersedes; it names the new one.
- `UPDATE: packages/server/src/commands/plugin.ts:36-43` - every field of a served row, `problem` included.
- `UPDATE: packages/server/test/server-http.test.ts` - the cases below.
- `UPDATE: docs/DAEMON.md` - the served answers mask a URL's credentials as they mask option values.

## Steps

1. A spec, as a string or as an object's `name`, that parses as a URL with a username or password is answered with the userinfo replaced by `<set>` (`git+https://<set>@host/repo`); every other spec is answered as it is.
2. `withoutSecrets` applies it to each plugin entry, and a served `plugin list` applies it to the row's `spec` and to any `problem` sentence that quotes the spec.
3. The terminal's answers are unchanged.

## Validation

- `server-http.test.ts`: a daemon whose file names `git+https://someone:PAT12345@example.com/x.git` as a string and as an object's `name`, asked `GET /api/config` and `GET /api/plugin/list` by a person holding the grant each needs, answers bodies with no `PAT12345` and no `someone`.
  Today both carry them.
- A spec with no credentials is answered unchanged.
- `node_modules/.bin/vitest run packages/server/test/server-http.test.ts` green.

## Resume
