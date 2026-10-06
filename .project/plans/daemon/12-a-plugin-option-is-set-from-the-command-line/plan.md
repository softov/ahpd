---
title: A plugin option is set from the command line, in the file or for one run
domain: daemon
status: built
priority: medium
created: 2026-09-29
revalidated: 2026-09-29
requires: []
decisions:
  - decisions/a-plugin-option-is-given-by-repeating-plugin-option.md
  - decisions/root-config-shows-daemon-keys-to-config-read-and-never-a-write-only-value.md
refs:
  - "[code://packages/server/src/commands/plugin.ts#L81-L173](../../../../packages/server/src/commands/plugin.ts#L81-L173) - `plugin install`, `remove` and `update`, the shape a new command copies"
  - "[code://packages/server/src/commands/options.ts#L367-L440](../../../../packages/server/src/commands/options.ts#L367-L440) - `optionsFrom`, a flag over the file"
  - "[code://packages/server/src/plugins.ts#L420-L440](../../../../packages/server/src/plugins.ts#L420-L440) - options merged and checked at load"
  - "[code://packages/server/src/install.ts#L137-L223](../../../../packages/server/src/install.ts#L137-L223) - `readEntry`, `writeEntry`, `enableNames` and `disableNames`"
---

## Goal

`ahpd plugin config` shows and sets a plugin's options in `config.json`, and `ahpd plugin enable` and `disable` turn one on and off, at the terminal and over HTTP.
`--plugin-option` sets an option for one run, the way `--port` sets the port.

## Reconnaissance

The files read are the `refs` above.

### Gaps

- A plugin's options can only be changed by editing `config.json`.
- No start flag reaches a plugin's options.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A plugin option is given on the command line by repeating `--plugin-option <plugin>.<key>=<value>`](../../../decisions/a-plugin-option-is-given-by-repeating-plugin-option.md) | 02 |
| [Daemon and plugin keys reach only connections with config:read, and a write-only value never leaves the host](../../../decisions/root-config-shows-daemon-keys-to-config-read-and-never-a-write-only-value.md) | 01 |

| What | Source | Task |
| --- | --- | --- |
| Everything after the plugin in `--plugin-option` is a key path set deep into the file's value, so `@ahpd/agent-claude.presets.x.model=...` changes one preset's model for the run and leaves the others | Softov, 2026-10-04, asked "daemon/12: `--plugin-option` sets one top-level key, so `@ahpd/agent-claude.presets.x.model=...` fails and a typed `presets` replaces every preset. What should it do?": "Nested key path" | 04 |
| A key on the way down that the options do not have is made, the way `mkdir -p` makes the directories on its way, so one run can add a preset the file has never heard of; one that is there and is not a plain object is refused, naming it, because setting into it would drop what it holds | Softov, 2026-10-04, asked "daemon/12: `--plugin-option` sets a key path now. What does a key that is not there on the way down do?": "A missing intermediate is created, like mkdir -p, so one run can add a preset" | 04 |
| The plugin is the longest name among the plugins this run loads that the text ahead of the `=` starts with, so a scoped name and a path whose extension holds a dot are found by asking the list rather than by counting dots | Softov, 2026-10-04, asked "daemon/12: a key path takes the dots a scoped name or a path's extension holds too. Where does the plugin name end?": "The plugin name ends at the longest name among the plugins this run loads that prefixes the text before the `=`; the rest is the key path" | 04 |
| `ahpd plugin config <name>` shows the options, `<name> <key>` one, `<name> <key> <value>` sets it, `--unset` removes it; the value is JSON when it parses, otherwise a string | Softov, 2026-09-29, asked what "--flags" meant: "Both", a config command and start flags | 01 |
| `ahpd plugin enable <name>` and `disable <name>` set the entry's `enabled` | (defaulted: root config can turn a plugin on and off, and the terminal matches it) | 01 |
| A set is checked against the plugin's `optionsSchema`, importing the module the loader would; a plugin that cannot be imported is written and said to be checked at the next start | (defaulted: refuse what is known bad, never block on what cannot be read) | 01 |
| The commands have the grants and `deploymentTokenOnly` of `plugin install`, and say to restart as it does | (defaulted: the shape of `plugin install`) | 01 |
| Each refuses a person in its own words: `change a plugin's options` for `plugin config`, `enable or disable a plugin` for `enable` and `disable` | Softov, review of daemon/12, 2026-09-30 | 01 |
| `--unset` of an option the entry does not set leaves the file as it is and says the key was not set | Softov, review of daemon/12, 2026-09-30 | 01 |
| `--plugin-option` refuses a plugin whose entry is `enabled: false`, as one this run does not load | Softov, review of daemon/12, 2026-09-30 | 02 |
| For an entry with `enabled: false`, show, set and unset never import the module, served or at the terminal; a set is stored unchecked and says it is checked when the plugin is enabled and loads | Softov, 2026-09-30, asked "Should `plugin config` import a disabled plugin's code to check values against its schema?": "Never import a disabled one" | 01 |
| A typed value keeps a number only when it reads back as typed, so a long id or `1.0` stays text; the docs say a JSON-quoted value is always a string | Softov, second review of daemon/12, 2026-09-30 | 01, 03 |
| `plugin update` refuses a person as one who may not "update a plugin", and the grants table has its row | Softov, second review of daemon/12, 2026-09-30 | 01, 03 |
| A typed object or array holding a whole number too large to keep exactly is refused, saying to quote it | Softov, third review of daemon/12, 2026-09-30 | 01, 03 |
| Only a number that would not keep its value is refused: a whole number past what a double holds exactly, or one too large to be a number, each with its own words | Softov, fourth review of daemon/12, 2026-09-30 | 01, 03 |
| A number is kept only when it reads back exactly as typed, at any depth: at the top it is text instead, and inside an object or array the value is refused, with its own words for one too large to be a number | Softov, fifth review of daemon/12, 2026-09-30 | 01, 03 |
| The docs give a `$secret` reference as the way to pass a credential on the command line or with `plugin config` | (defaulted: a typed flag lands in the shell's history and in `daemon.json`'s `argv`, and a `plugin config` value in `config.json`) | 04 |

## Proposed architecture

- **Data flow** - the commands share daemon/11's write path when it exists, and `readEntry` and `writeEntry` inside `oneAtATime` before; the flag is parsed in `optionsFrom` and merged over the entry's `options` for that run.
- **Layer responsibilities** - server only.
- **Source-of-truth files** - [`code://packages/server/src/commands/plugin.ts`](../../../../packages/server/src/commands/plugin.ts), [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - `ahpd plugin config`, `enable` and `disable`](task-01-plugin-config-enable-and-disable.md) | done | - |
| [02 - `--plugin-option`](task-02-plugin-option.md) | done | - |
| [03 - Docs](task-03-docs.md) | done | 01, 02 |
| [04 - A credential on the command line is a `$secret`](task-04-a-credential-on-the-command-line-is-a-secret.md) | done | 03 |

## Risks and tradeoffs

- A value typed at the shell lands in the shell's history and in the daemon record's `argv`, which a restart starts again; a credential is given as a `$secret` reference (task 04).
- A key path is made as deep as it goes, so a key typed wrong is added where it was meant to be rather than reaching the one that was meant; the value is checked against the schema at load, where a wrong key is a warning and the plugin still runs.

## Resume state

- **Done so far:** tasks 01, 02, 03 and 04 implemented, awaiting review. Task 04 gave `--plugin-option` a key path set as deep as it goes, made as `mkdir -p` makes it, under a plugin found by asking the list, and said a credential is a `$secret` reference by either flag or `plugin config`.
- **Reviews applied:** the review of 2026-09-30, the second, and the third, which refuses a typed value holding an inexact whole number, the fourth, which refuses only a number that would not keep its value, and the fifth, which holds a number to reading back as typed at every depth.
- **Next action:** Softov's review, which moves the tasks to `done`, and the three by-hand checks; see [implemented.md](implemented.md).
- **Open questions:** none.
- Served `plugin config` showing non-`writeOnly` values while `plugin list` and `config` mask every value is daemon/11's (task 04).
- **Watch out for:** a typed `--plugin` replaces the file's list; `--plugin-option` for a plugin not in the list, or switched off, is refused, naming it.

## Final verification checklist

- [ ] `ahpd plugin config @ahpd/agent-claude workerStop session` writes `config.json` and says to restart.
- [ ] With a second agent loaded beside `@ahpd/agent-claude` (a daemon with no backend refuses to start), `ahpd --plugin-option @ahpd/agent-claude.workerStop=nope` starts with that plugin skipped and the option named.
- [ ] A credential passed as `--plugin-option '<plugin>.<key>={"$secret":"<name>"}'` leaves only the reference in `daemon.json`.
- [x] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- [x] `plans/index.md` updated.
