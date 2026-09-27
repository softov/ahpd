---
title: The pinning cases fail when --host or a conflict's 409 breaks, and read no personal configuration
status: done
depends: [task-10-the-pinning-tests-bind-a-port-and-start.md, task-16-handlers-fail-by-throwing.md]
layer: "server"
refs:
  - "[code://packages/server/test/server-cli.test.ts#L486-L497](../../../../packages/server/test/server-cli.test.ts#L486-L497) - the two bind cases, both on `localhost`"
  - "[code://packages/server/test/server-http.test.ts#L596-L603](../../../../packages/server/test/server-http.test.ts#L596-L603) - the missing-person case, asserting `409`"
  - "[code://packages/server/src/commands/options.ts#L89-L91](../../../../packages/server/src/commands/options.ts#L89-L91) - `conflict`, `status: 409`"
  - "[code://packages/server/test/server-commands.test.ts#L71-L80](../../../../packages/server/test/server-commands.test.ts#L71-L80) and [#L104-L114](../../../../packages/server/test/server-commands.test.ts#L104-L114) - the two `daemon.config` cases, each given a `configFile` in a temporary directory"
---

## Objective

Each pinning case named here fails when the behaviour it names breaks: `--host` and the file's `host` are proved to reach the bind, a conflict answers 409, and no case reads the configuration of whoever runs the suite.

## Files

- `UPDATE: packages/server/test/server-cli.test.ts:486-497` - the bind cases.
- `UPDATE: packages/server/test/server-http.test.ts:596-603` - the status assertion.
- `UPDATE: packages/server/test/server-commands.test.ts:71-80, 104-114` - the two cases that run `daemon.config`.

## Steps

1. In both bind cases use a host that is not the default and that every CI machine resolves, `localhost`, and assert the announced URL starts with `ws://localhost:`; if the announcement prints the resolved address instead, assert that and say so in the Resume.
2. The missing-person case asserts `status` is `409`.
3. The `server-commands` cases that run `daemon.config` pass a `configFile` in a temporary directory, or set `XDG_CONFIG_HOME` to one for the case and restore it after.

## Validation

- With `optionsFrom` made to ignore `file.host`, the configuration bind case fails; with `--host` parsed and dropped, the flag bind case fails. Revert both.
- With `status: 409` removed from `conflict`, the missing-person case fails. Revert.
- With a malformed `~/.config/ahpd/config.json` in the environment of the run (a temporary `HOME`), `server-commands.test.ts` stays green.
- `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts packages/server/test/server-http.test.ts packages/server/test/server-commands.test.ts` green.

## Resume

Seen to fail, each break made and put back: with `optionsFrom` reading `undefined` instead of `file.host`, the configuration bind case failed; with it reading `file.host` alone, the flag bind case failed; with `status: 409` taken off `conflict`, the missing-person case answered 500 where it wanted 409. With `XDG_CONFIG_HOME` pointing at a directory whose `ahpd/config.json` is not JSON, `server-commands.test.ts` was green after the change and failed with `... could not be read: Unexpected token 'o'` before it, which is what the old `input: {}` did.

Done: both bind cases use `localhost`, which every machine resolves and which is not the default, and assert the announced URL starts with `ws://localhost:`; the announcement carries the host as given rather than a resolved address, so no note is needed for that. The missing-person case asserts 409. Both `server-commands` cases that run `daemon.config` pass a `configFile` in a temporary directory, which the file's header comment now says.

The first `server-commands` case never reached `loadConfig`: `checkScopes` refuses `ada` before the handler runs. Only the second one reads the file, and that is the one the malformed-configuration check exercises.
