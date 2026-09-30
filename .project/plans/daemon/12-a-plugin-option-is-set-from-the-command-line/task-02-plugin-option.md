---
title: "`--plugin-option`"
status: todo
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L117-L232](../../../../packages/server/src/commands/options.ts#L117-L232) - `serverFields` and `flagFields`"
  - "[code://packages/server/src/commands/options.ts#L388-L403](../../../../packages/server/src/commands/options.ts#L388-L403) - how `plugins` is built"
  - "[code://packages/server/src/commands/start.ts#L182-L191](../../../../packages/server/src/commands/start.ts#L182-L191) - the argv `start` forwards"
---

## Objective

`--plugin-option <plugin>.<key>=<value>`, repeatable and typed-only, sets that option over the file's for that run; the value is JSON when it parses; a plugin the list does not have is refused naming it; the value is checked at load like the file's.

## Files

- `UPDATE: packages/server/src/commands/options.ts` - the field and its merge in `optionsFrom`.
- `UPDATE:` the options tests.

## Steps

1. Tests first: two flags on one plugin merge over its file options; `=1` is a number and `=x` a string; a plugin not configured is refused; `ahpd start` forwards the flags to the child.
2. Implement; the split is at the first `=`, and the plugin name at the last `.` before it, since a scoped name holds none.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
