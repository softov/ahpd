---
title: A plugin option is set from the command line, in the file or for one run
domain: daemon
status: planned
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
| `ahpd plugin config <name>` shows the options, `<name> <key>` one, `<name> <key> <value>` sets it, `--unset` removes it; the value is JSON when it parses, otherwise a string | Softov, 2026-09-29, asked what "--flags" meant: "Both", a config command and start flags | 01 |
| `ahpd plugin enable <name>` and `disable <name>` set the entry's `enabled` | (defaulted: root config can turn a plugin on and off, and the terminal matches it) | 01 |
| A set is checked against the plugin's `optionsSchema`, importing the module the loader would; a plugin that cannot be imported is written and said to be checked at the next start | (defaulted: refuse what is known bad, never block on what cannot be read) | 01 |
| The commands have the grants and `deploymentTokenOnly` of `plugin install`, and say to restart as it does | (defaulted: the shape of `plugin install`) | 01 |

## Proposed architecture

- **Data flow** - the commands share daemon/11's write path when it exists, and `readEntry` and `writeEntry` inside `oneAtATime` before; the flag is parsed in `optionsFrom` and merged over the entry's `options` for that run.
- **Layer responsibilities** - server only.
- **Source-of-truth files** - [`code://packages/server/src/commands/plugin.ts`](../../../../packages/server/src/commands/plugin.ts), [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - `ahpd plugin config`, `enable` and `disable`](task-01-plugin-config-enable-and-disable.md) | todo | - |
| [02 - `--plugin-option`](task-02-plugin-option.md) | todo | - |
| [03 - Docs](task-03-docs.md) | todo | 01, 02 |

## Risks and tradeoffs

- A value typed at the shell lands in the shell's history; a credential is better set in the file or through root config.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-plugin-config-enable-and-disable.md](task-01-plugin-config-enable-and-disable.md).
- **Open questions:** none.
- **Watch out for:** a typed `--plugin` replaces the file's list; `--plugin-option` for a plugin not in the list is refused, naming it.

## Final verification checklist

- [ ] `ahpd plugin config @ahpd/agent-claude workerStop session` writes `config.json` and says to restart.
- [ ] `ahpd --plugin-option @ahpd/agent-claude.workerStop=nope` starts with that plugin skipped and the option named.
- [ ] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- [ ] `plans/index.md` updated.
