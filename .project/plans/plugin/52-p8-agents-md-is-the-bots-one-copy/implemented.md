---
title: AGENTS.md is the bot's one copy - implemented
date: 2026-11-03
refs:
  - git://e7df2dbd73352ce9c0f192b80e9b5085aec7bd45
  - "[code://packages/bot/src/agents.ts](../../../../packages/bot/src/agents.ts)"
  - "[code://packages/bot/src/folder.ts](../../../../packages/bot/src/folder.ts)"
  - "[code://packages/bot/src/store.ts](../../../../packages/bot/src/store.ts)"
  - "[code://packages/bot/src/provider.ts](../../../../packages/bot/src/provider.ts)"
  - "[code://packages/bot/src/plugin.ts](../../../../packages/bot/src/plugin.ts)"
  - "[code://docs/plugins/BOTS.md](../../../../docs/plugins/BOTS.md)"
---

A bot's persona has one copy: the `AGENTS.md` in its work folder. A read answers `name`, `description` and `instructions` from that file. A make or an edit writes only the parts the UI owns, so the bot's own sections, keys and comments stay byte for byte. A load moves the persona an older record carried into the file. A deleted name is never handed out again, and a folder that comes back after its delete is reported rather than removed. A bot on a computer, and every bot of a store with no YAML, keep the persona in the record. The docs say so.

## What was built

- [`code://packages/bot/src/agents.ts`](../../../../packages/bot/src/agents.ts) - `readAgents` and the writer. `spansIn` finds each key's span by line, so a quoted scalar across lines and a block scalar are read whole. A comment or blank line after a value stays. `instructionsProblem` names an instructions line that starts with a `##` heading.
- [`code://packages/bot/src/folder.ts`](../../../../packages/bot/src/folder.ts) - `readAgentsFile` tells a missing file, one with parts and one this host cannot read. `makeFolder` and `writeAgentsFile` write the UI's parts into the file, and `partsOf`, `withAgents` and `fromAgents` move the persona between the file and the record. A file's Instructions section wins over an older record's copy.
- [`code://packages/bot/src/store.ts`](../../../../packages/bot/src/store.ts) - the load moves an older record's parts into its file and puts the record back without them, once a read-back shows them. An unreadable file keeps the persona in the record with a problem line. A record whose slug has a tombstone is refused at the watch and at the load.
- [`code://packages/bot/src/provider.ts`](../../../../packages/bot/src/provider.ts) - a read takes the parts from the file, and a write writes the file before the record. A make that finds an `AGENTS.md` writes into it as an edit does. Instructions with a `## ` line are refused `-32602` before anything is written.
- [`code://packages/bot/src/plugin.ts`](../../../../packages/bot/src/plugin.ts) - `moveData` moves the older layout into one folder per bot and keeps a tombstoned folder that still holds `bot.md`. A `root` inside the configuration folder is refused at load, with the default used instead.
- [`code://packages/bot/src/names.ts`](../../../../packages/bot/src/names.ts), [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - one collection for each bot's chat rows and session rows, and the chat logs under `bots/<slug>/logs/`.
- [`code://docs/plugins/BOTS.md`](../../../../docs/plugins/BOTS.md) - the record file, the persona and the slug sections say where the persona lives. They say what a write keeps, what the load moves, and what a deleted name costs. The computer bot paragraph and the `root` option match the code that exists.

## Verified

- `packages/bot/test/` - 15 files and 218 tests pass with `pnpm --filter @ahpd/bot test`, run alone under the shared vitest lock. The cases cover the parser and writer, the store's move, and the tombstone refusals. They cover the provider's make and edit roads, the load's folder moves, the template and the docs samples.
- [`code://packages/bot/test/bot-docs.test.ts`](../../../../packages/bot/test/bot-docs.test.ts) reads the page's `bot.md` sample as a record without the persona. It reads the `AGENTS.md` sample through `readAgents`, so the printed files are files the daemon accepts.
- `pnpm -s build`, `pnpm exec tsc -p tsconfig.json --noEmit` and `pnpm -s boundary` pass after each task.
- By hand, waiting: the daemon on 37537 or 5180 was not touched and no daemon was started, so none of these ran.
  - Make a bot and read its `AGENTS.md` and `CLAUDE.md`.
  - Edit the instructions in the UI and see that comments and other sections stay.
  - Let the bot rewrite its file and read the new parts back.
  - Delete a bot and see its folder go, the tombstone stay and the work folder stay.
  - Put a `bot.md` back after a delete and see it reported and left out.
  - Start with an older record carrying the persona and see the load move it.
  - Edit a computer bot and see the change stay in the record.
  - Set `root` inside the configuration folder and see the problem line and `~/.bots`.

## Departures from the plan

- Task 03 is dropped. An edit to a bot on a computer waits for the machine. The plan's [deferred.md](deferred.md) sends it to task 04 of the bots plan *A bot runs in a machine*. Until then an edit changes the record, and nothing writes it to the file.
- The host's `@cofold/yaml` cannot read a quoted scalar across lines. A file written with one has its quoted entry replaced by a block scalar, and the value reads back the same. Task 09 records this.
- The host-refusal test lives in `bot-provider.test.ts` and the `root` test in `bot-folder.test.ts`, not in `bot-agents.test.ts`. Both need a host, and those are the two files that build one.
- A tombstone name that is not a slug is reported and removes nothing, and a tombstoned folder that still holds `bot.md` is kept and reported. Both are in the plan's Answers table.
- The persona move tolerates a file whose Instructions section reads back as the new section plus the older body. That is the shape the writer makes for a record with no section, and task 08 records why the check compares a prefix.
- The docs also say when the `root` option is refused and that a make writes into a file it finds. Task 10 records that both are behavior tasks 08 and 09 built.

## Left for later

- An edit to a bot on a machine that waits for the machine - see [deferred.md](deferred.md).
- The machine task 04, which reads and writes a computer bot's `AGENTS.md` through the computer and keeps the last parts for an offline read.
