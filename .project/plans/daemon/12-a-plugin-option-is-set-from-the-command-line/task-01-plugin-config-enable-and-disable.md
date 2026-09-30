---
title: "`ahpd plugin config`, `enable` and `disable`"
status: implemented
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/plugin.ts#L81-L135](../../../../packages/server/src/commands/plugin.ts#L81-L135) - `plugin install`, the shape"
  - "[code://packages/server/src/install.ts#L137-L223](../../../../packages/server/src/install.ts#L137-L223) - the file helpers"
---

## Objective

`plugin.config`, `plugin.enable` and `plugin.disable` exist on the CLI and over HTTP as the plugin table in the plan says, and a served answer masks `writeOnly` values.

## Files

- `UPDATE: packages/server/src/commands/plugin.ts` - the three actions, in `oneAtATime`.
- `UPDATE: packages/server/src/install.ts` - an entry's `options` and `enabled` set and unset.
- `UPDATE:` the server command, CLI and HTTP tests.

## Steps

1. Tests first in a temp config directory: show, get, set, unset, a refused value naming the option, enable and disable of a string spec and of an object spec, a name not configured refused, the served answer masking a `writeOnly` option.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

- `plugin config` is two declarations in `commands/plugin.ts`, because `@cofold/commands` 0.2.2 refuses any slot after an optional one: `plugin.config` is `plugin config <name> [key]` with `--unset` (`POST /plugin/config`), and `plugin.config.set` is `plugin config <name> <key> <value>` (`POST /plugin/config/set`); both run one body. `plugin.enable` and `plugin.disable` are `POST /plugin/enable` and `/plugin/disable`. All four have `config:write` and are the deployment token's alone; a person is refused as one who "may not change a plugin's options" (`plugin config`) or "may not enable or disable a plugin" (`enable`, `disable`).
- `install.ts` has `pluginEntry`, `setPluginOption` and `setPluginEnabled` over `readEntry` and `writeEntry`, run inside `oneAtATime`. Enabling a string entry leaves it as it is; enabling an object entry writes `enabled: true`; an unset that empties `options` removes the key. `setPluginOption` answers whether the file changed: an unset of an option the entry does not set, a string entry included, leaves the file as it is, and `plugin config` says `<name> sets no <key> in <file>.` with no restart line.
- `plugins.ts` has `optionsSchemaOf`, which imports the module a load would and answers its `optionsSchema` or nothing; the manifest reading and the entry lookup of `loadOne` moved into `locate`, which both use.
- A typed value is read by `typedValue` in `commands/options.ts`, JSON when it parses and text otherwise, the one helper `plugin config` and `--plugin-option` share.
- A set is checked against that key's own schema only, so options can be set one at a time; a missing required key is still the load's to report. A key the schema does not name is written with a line saying so, as the load passes it through.
- Served, a `writeOnly` option is `<set>`; when the plugin cannot be imported every value is `<set>`, since nothing says which one is a credential.
- The restart line is one constant, `RESTART`, for daemon/13 task 03 to change.
- `main.ts` lists a verb's sub-commands once each, since `config` is now the word of two declarations.
- Tests: `packages/server/test/plugin-config.test.ts`, 14 cases (show, get, empty, set as JSON and text, a refused value naming the option, a plugin that cannot be imported written and said to be checked at the next start, unset, a name not configured, enable and disable of a string and an object entry, a string entry left alone, served masking of `writeOnly` in show, get and set, a served 400, served enable and disable), with the fixture `test/fixtures/plugin-secret`, and "leaves the file alone and says so when the option was not set, a string entry included"; `server-cli.test.ts` "sets with three words and shows with two"; the grants and each command's refusal words in `server-commands.test.ts`.
- Failed first: all 14 cases, the commands not existing; then every case on cofold's "required slot after an optional one" for `:key? :value?`, which is why the command is two. The CLI case and the grant lines were written after the implementation and did not fail first. The sub-command listing case in `server-cli.test.ts` failed on the doubled `config`, which the `main.ts` change fixed, and its expected line now names the new words.
- Not known to the plan: the served `daemon.config` and `plugin.list` still answer every option value as `<set>`, under the superseded decision, while served `plugin config` shows a value that is not `writeOnly`; bringing all three to one mask is work in daemon/11 task 04.
- Review of 2026-09-30: the refusal words, the unset, the shared `typedValue` and `optionsSchemaOf` without its unused `defaults` and `version` are in the lines above; their cases were written with the change and not run before it.
- Second review, 2026-09-30.
- `typedValue` (`commands/options.ts` L84) keeps a parsed number only when `String(value)` is the typed text, so `12345678901234567890` and `1.0` stay text; `42`, `-1.5` and `"123"` read as before. Test: the round-trip case in `server-commands.test.ts`.
- `plugin update` refuses a person as one who may not "update a plugin" (`commands/plugin.ts` L162); the grants case in `server-commands.test.ts` expects the words.
- `configure` in `commands/plugin.ts` (L228) reads `disabled` from the entry's `enabled: false` and then never calls `optionsSchemaOf`, at the terminal or served: a set is written with `<name> is switched off, so <key> is written unchecked; it is checked when the plugin is enabled and loads.`, and a served answer is `<set>` for every value of it. Test: "a plugin switched off" in `plugin-config.test.ts`, with the fixture `test/fixtures/plugin-marker`, whose top level writes the file `AHPD_MARKER` names; a terminal set, show and unset and a served set and show leave no marker, and an enabled set, the positive control, leaves one.
- These cases were written with the code they cover.
- Third review, 2026-09-30: `typedValue` (`commands/options.ts` L85) refuses, through `stop`, an object or array holding a whole number past `Number.MAX_SAFE_INTEGER`, found by `inexact` (L98), with `<typed> holds a whole number too large to keep exactly, read as <n>; write it in quotes, as a JSON string.` Test: "refuses a JSON value holding a whole number too large to keep, and says to quote it" in `server-commands.test.ts`, written with the change.
- Fourth review, 2026-09-30: `typedValue` (`commands/options.ts` L86) reads each number literal of an object or array from the typed text, strings skipped, and refuses one too large to be a number (`1e400`), `<typed> holds <literal>, too large to be a number; write it in quotes, as a JSON string.`, and a whole number whose value a double does not hold exactly (`9007199254740993`), `<typed> holds <literal>, a whole number too large to keep exactly; write it in quotes, as a JSON string.`; `2^53` and `1e300` are kept. Test: "refuses a JSON value holding a number that would not keep its value, and says to quote it" in `server-commands.test.ts`, written with the change.
- Fifth review, 2026-09-30: `typedValue` (`commands/options.ts` L85) holds every number to the top-level rule, reading back exactly as typed. Inside an object or array, where it cannot become text, a literal that does not is refused with `<typed> holds <literal>, which would be kept as <read>; write it in quotes, as a JSON string.`, so `{"a":1.0}`, `{"a":1e21}`, a long decimal and a long id are refused; one too large to be a number keeps its own words. Test: "refuses a JSON value holding a number that would not read back as typed, and says to quote it" in `server-commands.test.ts`, written with the change.
