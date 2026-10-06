---
title: "`--plugin-option`"
status: done
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

- `serverFields.pluginOptions` is `--plugin-option PLUGIN.KEY=VALUE`, repeatable, and typed-only (in `TYPED_ONLY`, so `config.json` does not take it); `optionsFrom` merges each over the options of the plugin it names, after the list is built, so it applies to the file's list and to a typed `--plugin` alike.
- The split is at the first `=` and the name at the last `.` before it, which also reads a path spec such as `./p/index.ts.mode=fast`; an empty name or key, or no `=`, is refused naming the typed flag; a name the run does not load, or whose entry is `enabled: false`, is refused naming it. The value is read by `typedValue`, shared with `plugin config`.
- `ahpd start` forwards it with no change, since the forwarded line keeps every option that is not the parent's.
- The help paragraph after the run's flags now says what `--plugin-option` sets.
- Tests: in `server-commands.test.ts`, a `--plugin-option` block of seven cases (a merge over file options, JSON and text values with a value holding `=`, a scoped name and a path, a typed `--plugin`, a plugin not loaded refused, malformed flags refused, not a file key) and the flag in the start flag list and the repeatable set; `server-cli.test.ts` "forwards --plugin-option to the child, which loads with it", a real `start` whose schema fixture loads only because the option reached it.
- Tests after the review of 2026-09-30: "refuses a plugin whose entry is switched off, which this run does not load" in `server-commands.test.ts`, written with the change and not run before it.
- Failed first: the merge cases (the option was ignored), the refusals, the flag lists, and the `start` case (`--plugin-option` was an unknown option); "is not a key the configuration file may hold" passed before, as any unknown key did. `config-check.test.ts` "is built from the flags" then failed on the new typed-only field, and now skips it as it skips `noPlugins`.
