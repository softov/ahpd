---
title: "`plugin config` says when the running daemon's `--plugin-option` overrides the key it set"
status: todo
depends: [task-01-the-record-keeps-the-argv.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/plugin.ts#L273-L283](../../../../packages/server/src/commands/plugin.ts#L273-L283) - the set and unset of `plugin config`, and the restart line after them"
  - "[code://packages/server/src/daemon.ts#L25-L29](../../../../packages/server/src/daemon.ts#L25-L29) - `argv` in the record, which a restart starts again"
  - "[code://packages/server/src/daemon.ts#L84](../../../../packages/server/src/daemon.ts#L84) - `running`, the record reader `plugin.ts` already imports"
  - "[code://packages/server/src/commands/options.ts#L662-L676](../../../../packages/server/src/commands/options.ts#L662-L676) - how `--plugin-option` splits the plugin and the key"
---

## Objective

A `plugin config <name> <key>` set or `--unset`, at the terminal or served, says that the change will not take effect on `ahpd restart` when the running daemon's recorded `argv` holds a `--plugin-option` for that plugin and key, naming the flag, because a restart starts with that argv again and the flag wins over the file.

## Files

- `UPDATE: packages/server/src/commands/options.ts` - the split of one `--plugin-option` value into plugin, key and value, exported so `plugin config` reads a recorded flag the way a start does.
- `UPDATE: packages/server/src/commands/plugin.ts:273-283` - after the write, read `running()?.argv` and say the override line before the restart line.
- `UPDATE: packages/server/test/` (the `plugin config` tests) - the cases below.

## Steps

1. Test first: a record whose `argv` has `--plugin-option @ahpd/agent-claude.workerStop=session`; `plugin config @ahpd/agent-claude workerStop turn` writes the file and says `--plugin-option @ahpd/agent-claude.workerStop=session`, recorded for this daemon, overrides it on `ahpd restart`; the same for `--unset`; a different key, a different plugin and no record say nothing more.
2. Both spellings of the flag in argv count: `--plugin-option X` and `--plugin-option=X`.
3. Served, the answer carries the same line in its words and an `overriddenBy` field naming the flag.
4. Whether a restart keeps the flag at all is the open question in the plan; if it is answered that a restart drops one-run flags, this task is dropped.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
