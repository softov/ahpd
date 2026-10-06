---
title: Only user token takes --host and --port
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L490-L495](../../../../packages/server/src/commands/options.ts#L490-L495) - `userAt`"
  - "[code://packages/server/src/commands/options.ts#L516-L556](../../../../packages/server/src/commands/options.ts#L516-L556) - `userAddFields`, `userTokenFields`, `userPrimaryFields`, each spreading `userAt`"
  - "[code://packages/server/src/commands/user.ts#L215-L227](../../../../packages/server/src/commands/user.ts#L215-L227) - the one read"
  - "[code://packages/server/test/server-commands.test.ts#L607-L613](../../../../packages/server/test/server-commands.test.ts#L607-L613) - the assertion that pins them"
---

## Objective

`user token` declares `--host` and `--port`; `user list`, `rm`, `member`, `primary` and `add` do not, and refuse them as any unknown option.

## Files

- `UPDATE: packages/server/src/commands/options.ts:490-556` - `userAt` is `configFile` and `users`; `userTokenFields` adds `host` and `port`. Today every `user` verb declares both and only `user token --url` reads them (user.ts:227), so `ahpd user rm ada --port 9310` is accepted and the port means nothing.
- `UPDATE: packages/server/src/commands/user.ts:46-75` - the comment on `people` says only `user token` passes them.
- `UPDATE: packages/server/test/server-commands.test.ts:607-613` - the assertion is the reverse: those four verbs and `user add` do not offer `--host` or `--port`; `user token` does.
- `UPDATE: packages/server/test/server-cli.test.ts` - the case below.

## Steps

1. Failing case first: `ahpd user list --users <file> --port 9310` exits 2 with `Unknown option --port`. Today it lists.
2. Change the test's assertion and see it fail before the fix.
3. Move `host` and `port` from `userAt` to `userTokenFields`.

## Validation

- Both fail on `e1c4ccc` and pass after.
- `pnpm exec vitest run packages/server/test/server-commands.test.ts packages/server/test/server-cli.test.ts`.

## Resume

Implemented. `userAt` is `configFile` and `users`; `userTokenFields` adds `host` and `port` beside `url`, with a note saying why the address is that verb's alone. The comment on `people` in `user.ts` moves with it: it said "`--host` and `--port` here" and now says the two are `user token`'s flags, which every other verb is refused. The configuration file's `host` and `port` are still read by every verb as the address to fall back on - it is the flags that moved, not the fallback.

Both cases failed first. The flag declaration case failed with `expected [ '--config-file', '--users', …(2) ] to not include '--host'`, and the CLI case with `expected +0 to be 2` on `user list --users <file> --port 9310`, which listed rather than refusing.

Gates: `npx tsc -b` clean, `pnpm exec vitest run packages/server/test/server-commands.test.ts packages/server/test/server-cli.test.ts` 108 passed.
