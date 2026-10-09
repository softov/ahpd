---
title: Each package's README says how to use it, how to configure it and what each option does
domain: documentation
status: active
priority: medium
created: 2026-10-08
revalidated: 2026-10-09
refs:
  - "[code://packages/server/README.md](../../../../packages/server/README.md) - lists 9 commands; `packages/server/src/commands/` has 18 files"
  - "[code://packages/server/src/commands/options.ts](../../../../packages/server/src/commands/options.ts) - the flags each command takes, `programGlobals` among them"
  - "[code://packages/agent-claude/README.md](../../../../packages/agent-claude/README.md) - the most complete README, with `In the daemon` and `In your own host`; its option table sits inside `In the daemon`"
  - "[code://packages/agent-claude/src/plugin.ts](../../../../packages/agent-claude/src/plugin.ts) - `optionsSchema`, the options the daemon checks"
  - "[code://packages/agent-acp/src/plugin.ts](../../../../packages/agent-acp/src/plugin.ts) - `optionsSchema`"
  - "[code://packages/agent-cofold/src/plugin.ts](../../../../packages/agent-cofold/src/plugin.ts) - `optionsSchema`"
  - "[code://packages/agent-pi/src/plugin.ts](../../../../packages/agent-pi/src/plugin.ts) - `optionsSchema`"
  - "[code://packages/bot/src/plugin.ts](../../../../packages/bot/src/plugin.ts) - `optionsSchema`"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - `optionsSchema`"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts](../../../../packages/tunnel-devtunnel/src/plugin.ts) - `optionsSchema`"
  - "[code://packages/sdk/README.md](../../../../packages/sdk/README.md) - the library's README, with `Use` and `Options`"
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) - `optionsSchema` is what a load checks; `ahpd.options` in `package.json` names only the required options"
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md) - the commands, the flags and the configuration file in full"
---

## Goal

A person who opens a package's README can install it, write its configuration and run it without reading the code.
Each README shows how to use the package and its block in the ahpd configuration.
It lists the ahpd commands that act on the package, and explains every option it takes.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -n "^#" packages/*/README.md` - every package has an `Options` section, except `agent-claude`, where it is inside `In the daemon`.
  The order of sections differs from one package to the next.
- `rg -ln "export const optionsSchema" packages/*/src` - all seven plugin packages export one, in `src/plugin.ts`.
- `node -e` over each `package.json` `ahpd.options` - the keys there are not the full list, which is correct: `docs/PLUGINS.md` says that field names the required options only.
- `ls packages/server/src/commands/` - `authorize`, `configure`, `proxy`, `registry`, `restart`, `run`, `scopes`, `served`, `teams`, `usage`, `user` and `vault` are absent from the server README's `Commands` block.

### Gaps

- The Claude README names `computerCli` and `computerCliFallback`; whether `optionsSchema` holds them is unchecked.
- The acp README names `toolsChanged`; whether `optionsSchema` holds it is unchecked.
- The handoff of 2026-10-03 noted README and manifest mismatches in computer, tunnel-devtunnel, agent-acp, agent-pi and agent-cofold; this plan checks each one against `optionsSchema`.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Each README says how to use the code, its ahpd configuration and its CLI commands, and explains each option | Softov, 2026-10-08: "revising the package READMEs: how to use the code, its ahpd config and CLI commands, each option explained" | 01-04 |
| A plugin README has these sections in this order: one paragraph on what it is, `In the daemon`, `Options`, `Commands`, `In your own host`, the package's own sections, `Documentation`, `License` | (defaulted: `agent-claude`'s headings, with `Options` lifted out to its own section) | 02, 03 |
| `In the daemon` shows the install command and a complete `config.json` block with the options a person sets most often | (defaulted) | 02, 03 |
| `Options` is a table of option, default and what it does, one row for each property of `optionsSchema`; a nested object gets its own table under the parent's name | (defaulted: `agent-acp`'s `presets.<id>` table) | 02, 03 |
| The option list comes from `optionsSchema`; where a README and the code disagree, the code wins and the README is corrected | (defaulted: `docs/PLUGINS.md` says the load checks `optionsSchema`) | 02, 03 |
| `Commands` lists the ahpd commands that act on the package: `plugin install`, `plugin update`, `plugin list`, and `vault` where an option takes `$secret` | (defaulted: plugins add no commands of their own) | 02, 03 |
| The server README lists every command and every global flag, one line each, and links `docs/DAEMON.md` for the detail | (defaulted) | 01 |
| A long explanation stays in `docs/`; the README row gives one sentence and links it | (defaulted: documentation/03 gave each area one doc) | 01-04 |
| No test checks the README rows against `optionsSchema` in this plan | Softov, 2026-10-09, asked "should a test check that every optionsSchema property has a row in its package README?" and answered "No, not now" | - |
| `packages/bot` and `packages/agent-cofold` get a copy of the root `LICENSE` | Softov, 2026-10-09, asked "Should they get one?" and answered "Yes, copy the root one" | 02, 03 |

## Proposed architecture

- **Layer responsibilities** - `packages/server`: the commands and flags · the seven plugin packages: their options and configuration · `packages/sdk`: building a host with the code.
- **Source-of-truth files** - each plugin's `src/plugin.ts` `optionsSchema`; [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts) for the flags.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The server README lists every command and flag](task-01-the-server-readme-lists-every-command-and-flag.md) | implemented | - |
| [02 - Each agent README explains every option](task-02-each-agent-readme-explains-every-option.md) | implemented | - |
| [03 - The bot, computer and tunnel READMEs explain every option](task-03-the-bot-computer-and-tunnel-readmes-explain-every-option.md) | implemented | - |
| [04 - The sdk README says how to build a host](task-04-the-sdk-readme-says-how-to-build-a-host.md) | implemented | - |

## Risks and tradeoffs

- A README drifts again when an option is added - the `optionsSchema` comment in each `plugin.ts` names the README, so the next change sees it.
- The READMEs and `docs/` say the same thing twice - the README row is one sentence and links the doc for the rest.

## Resume state

- **Done so far:** tasks 01-04 are implemented and wait for review. [implemented.md](implemented.md) lists the files and the departures.
- **Next action:** review the README diffs against each `optionsSchema` and against `HostOptions`.
- **Open questions:** the computer, Claude and acp schemas leave out fields that the code accepts. The READMEs document these fields. Decide whether the schemas must declare them.
- **Watch out for:** a README row with no schema property is a field that the code reads. It is not an error. Do not remove it until the schema question has an answer.

## Final verification checklist

- [ ] Every `optionsSchema` property in the seven plugins has a row in its README, and no row names a property the schema does not have.
- [ ] Every file in `packages/server/src/commands/` has a line in the server README.
- [ ] Every README link resolves.
- [ ] `pnpm build` passes, since the READMEs ship in the packages.
- [ ] `plans/index.md` updated.
