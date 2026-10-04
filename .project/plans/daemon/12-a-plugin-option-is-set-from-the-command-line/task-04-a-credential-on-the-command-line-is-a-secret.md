---
title: A `$secret` on the command line, and everything after the plugin is a key path
status: implemented
depends: [task-03-docs.md]
layer: "server"
refs:
  - "[code://docs/DAEMON.md#L440-L449](../../../../docs/DAEMON.md#L440-L449) - the `--plugin-option` paragraph, which says a credential is better set with `plugin config`"
  - "[code://packages/server/src/daemon.ts#L25-L29](../../../../packages/server/src/daemon.ts#L25-L29) - `argv` in the daemon record, which keeps every typed flag"
  - "[code://packages/server/src/plugins.ts#L540](../../../../packages/server/src/plugins.ts#L540) - every `{ \"$secret\": \"<name>\" }` in an option is read at load"
  - "[code://packages/server/src/commands/options.ts#L680-L720](../../../../packages/server/src/commands/options.ts#L680-L720) - the `--plugin-option` fold, which found the plugin by the last dot and set one top-level key"
  - "[code://packages/server/test/server-commands.test.ts#L205](../../../../packages/server/test/server-commands.test.ts#L205) - `describe('--plugin-option')`"
---

## Objective

`docs/DAEMON.md` says a credential given with `--plugin-option` or `plugin config` is written as `{"$secret":"<name>"}`, with the value kept in the vault, because a plain value lands in the shell's history, in `daemon.json`'s `argv` for a restart, or in `config.json`.

And everything after the plugin in `--plugin-option` is a key path set deep into the entry's options, so `@ahpd/agent-claude.presets.x.model=...` changes one preset's model for the run and leaves the others, where a typed `presets` replaced every one of them.

## Files

- `UPDATE: docs/DAEMON.md:449` - the sentence that says a credential is better set with `plugin config`.
- `UPDATE: docs/DAEMON.md:282,440-448` - the `--plugin-option` row of the options table and the paragraph, which spelled the key as one dot.
- `UPDATE: packages/server/src/commands/options.ts:378` - `serverFields.pluginOptions`, the description and the flag's value spelling.
- `UPDATE: packages/server/src/commands/options.ts:205` - `setAt`, which sets a value at a key path in a copy.
- `UPDATE: packages/server/src/commands/options.ts:680-720` - the `--plugin-option` fold: the plugin is the longest name this run loads that the text starts with, and the rest is the key path.
- `UPDATE: packages/server/test/server-commands.test.ts:205` - `describe('--plugin-option')`.

## Steps

1. Replace that sentence: a typed value lands in the shell's history and in the daemon record's `argv`, which `ahpd restart` starts again; a credential goes as a `$secret` reference, with one example such as `ahpd --plugin-option '@ahpd/plugin-orders.apiKey={"$secret":"host:stripe"}'`, and a link to the vault section.
2. One line per paragraph, as the surrounding prose is.
3. In `optionsFrom`, find the plugin by asking the list rather than by counting dots: the longest name this run loads, enabled, that the text ahead of the first `=` starts with. What is left is the key path, split at `.` and set with `setAt`.
4. `setAt` returns a new options object with the value set at the path, making a key on the way down that is not there, and refusing one that is there and is not a plain object, naming it.
5. What is left of the text that names no plugin this run loads is refused as before: the first dot still says which name was meant in the message, so `c.k=1` names `c`, and a text with no dot in it is the `<plugin>.<key>=<value>` refusal.
6. The options table, the paragraph and the flag's description say the key is a path.

## Validation

- Read against `optionsFrom` (`typedValue` parses the JSON object) and the vault section of the same file.
- By hand: `ahpd vault set host:x`, then a start with that `--plugin-option`; `daemon.json` holds the reference and not the value.
- `describe('--plugin-option')` covers a scoped name and a path found by asking the list, a key set deep leaving the others, a key made on the way down, a key path through something that is not an object, the longest name that fits, and the refusals as they were worded.

## Resume

Built. `docs/DAEMON.md` and `options.ts` changed, the tests cover it, and the gates are in the plan's Resume state.