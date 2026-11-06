---
title: The masks read both keywords
status: done
depends: [task-01-the-host-reads-secret.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/config.ts](../../../../packages/server/src/commands/config.ts) - the `<set>` answer"
  - "[code://packages/server/src/pluginschannel.ts](../../../../packages/server/src/pluginschannel.ts) - `secretsOf`"
---

## Objective

The configuration answer shows a value as `<set>` when its schema says `writeOnly` or `secret`.
A served load problem takes out a value its schema marks with either keyword.

## Files

- `UPDATE: packages/server/src/commands/config.ts:53-75` - the mask answers `SET` for `secret: true` as for `writeOnly: true`, and the comment names both.
- `UPDATE: packages/server/src/commands/config.ts:134-160` - the comments name both keywords.
- `UPDATE: packages/server/src/pluginschannel.ts:49-67` - `secretsOf` collects a value marked `secret` too.
- `UPDATE: packages/server/src/pluginschannel.ts:240` - the comment names both keywords.
- `UPDATE: packages/server/src/plugins.ts:1072` - the comment names both keywords.
- `UPDATE: packages/server/src/commands/plugin.ts:106` - the comment names both keywords.
- `UPDATE: packages/server/test/plugin-mask.test.ts` - an option marked `secret` answers `<set>`.
- `UPDATE: packages/server/test/plugins-channel.test.ts` - a load problem takes out a `secret` value.

## Steps

1. In the config mask, answer `SET` when the node has `secret: true` or `writeOnly: true`.
2. Keep `NOTHING_MARKED` as it is.
3. In `secretsOf`, collect a string marked `secret: true` as one marked `writeOnly: true`.
4. Change the four comments.
5. Write the tests.

## Validation

- `plugin-mask.test.ts`: a plugin option marked `secret` answers `<set>`; one marked `writeOnly` still does.
- `plugins-channel.test.ts`: a load problem that quotes a `secret` value does not show it.
- Run `pnpm typecheck` and `pnpm test`.

## Resume

