---
title: "`plugin config` says when the running daemon's `--plugin-option` overrides the key it set"
status: done
depends: [task-01-the-record-keeps-the-argv.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/plugin.ts#L308-L336](../../../../packages/server/src/commands/plugin.ts#L308-L336) - the set and unset of `plugin config`, and the restart line after them"
  - "[code://packages/server/src/daemon.ts#L25-L30](../../../../packages/server/src/daemon.ts#L25-L30) - `argv` in the record, which a restart starts again"
  - "[code://packages/server/src/daemon.ts#L91](../../../../packages/server/src/daemon.ts#L91) - `running`, the record reader `plugin.ts` already imports"
  - "[code://packages/server/src/commands/options.ts#L300-L340](../../../../packages/server/src/commands/options.ts#L300-L340) - how `--plugin-option` splits the plugin and the key"
---

## Objective

A `plugin config <name> <key>` set or `--unset` can be overridden by a `--plugin-option` in the running daemon's recorded `argv`.
Then it says that the change does not take effect on `ahpd restart`, and names the flag.
A restart starts with that `argv` again, and the flag wins over the file.

## Files

- `UPDATE: packages/server/src/commands/options.ts:300-340` - `pluginOptionIn` and `splitPluginOption`, one `--plugin-option` value split into plugin, key and value, exported so `plugin config` reads a recorded flag the way a start does; the start's own loop calls the first.
- `UPDATE: packages/server/src/commands/plugin.ts:28-59` - `overridden`, the line, and `recordedOverride`, the recorded flag it names.
- `UPDATE: packages/server/src/commands/plugin.ts:317-336` - after the write, read `running()?.argv` and say the override line before the restart line, and carry the flag in the answer.
- `UPDATE: packages/server/test/plugin-config.test.ts` - the cases below.
- `UPDATE: docs/DAEMON.md:467-469` - the override line beside the restart line.

## Steps

1. Test first: a record whose `argv` has `--plugin-option @ahpd/agent-claude.workerStop=session`; `plugin config @ahpd/agent-claude workerStop turn` writes the file and says `--plugin-option @ahpd/agent-claude.workerStop, recorded for this daemon, overrides it on ahpd restart.`, with no value; the same for `--unset`; a different key, a different plugin and no record say nothing more.
2. Both spellings of the flag in argv count: `--plugin-option X` and `--plugin-option=X`.
3. Served, the answer carries the same line in its words and an `overriddenBy` field naming the flag.
4. A restart keeps every one-run flag, so the recorded flag always wins over the file on `ahpd restart`.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

- `pluginOptionIn` in `options.ts` finds the plugin a `--plugin-option` names, and the key path after it.
- The start and `splitPluginOption` both use it, so a start and `plugin config` read a flag the same way.
- The start's refusals, their order and their words are unchanged.
- `recordedOverride` in `plugin.ts` reads `--plugin-option X` and `--plugin-option=X` in the recorded `argv`.
- A flag that sets a path under the key does not count, and a record with no `argv` says nothing.
- The line is said after the write and before the restart line, for a set and an unset.
- The line names the flag up to its `=` and never its value, by Softov's answer in the plan.
- Served, the answer carries `overriddenBy` and `words`, and both are absent when nothing overrides.
- `plugin-config.test.ts` covers both spellings, an unset, another key, another plugin, no `argv`, no record and the served answer.
- `docs/DAEMON.md` says the line beside the restart line.
- The review gates on main `d20a6b3` pass 4672 tests in 264 files.
