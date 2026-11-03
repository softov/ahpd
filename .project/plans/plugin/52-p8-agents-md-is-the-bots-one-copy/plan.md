---
title: AGENTS.md is the bot's one copy
domain: plugin
status: active
priority: medium
created: 2026-10-17
revalidated: 2026-10-17
requires:
  - plans/plugin/52-p3-a-message-wakes-the-bot-and-it-replies/plan.md
changes: []
creates: []
refs:
  - "[code://packages/bot/src/record.ts#L84-L90](../../../../packages/bot/src/record.ts#L84-L90) - `description` and `instructions` on the bot record"
  - "[code://packages/bot/src/plugin.ts#L143](../../../../packages/bot/src/plugin.ts#L143) - the `bots` collection, whose body is `instructions`"
  - "[code://packages/bot/src/template.ts#L131-L137](../../../../packages/bot/src/template.ts#L131-L137) - `agentsFilled`, which copies the record into the file once"
  - "[code://packages/bot/src/folder.ts](../../../../packages/bot/src/folder.ts) - `prepareFolder`, which writes `AGENTS.md` when it is absent"
  - "[code://packages/bot/src/provider.ts](../../../../packages/bot/src/provider.ts) - the read, write and delete roads of a bot"
---

## Goal

A bot's persona has one copy: the `AGENTS.md` in its folder.
The file has a frontmatter with `version`, `name` and `description`, and a `## Instructions` section.
The UI reads and edits only those parts, and the bot owns the rest of the file.
An edit in the UI changes the file, so the next back session reads it.
An edit by the bot changes the file, so the UI shows it.
A bot on a computer keeps an edit made while the computer is offline, and writes it when the computer is back.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Gaps

- The record and `AGENTS.md` both hold the persona, and nothing keeps them the same.
- `AGENTS.md` is written only at the first wake, so an edit in the UI after it goes nowhere.
- An edit by the bot to `AGENTS.md` does not show in the UI.
- The file has no parts that a parser can find.
- The host cannot read the folder of a bot on a computer.
- A delete of a bot leaves its rows in `bot-chats/` and `bot-sessions/`, and its chat logs.
- A record collection name is a slug, so a plugin cannot keep a collection in a subfolder.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `AGENTS.md` is the one copy of the persona, and the UI edits only its frontmatter and its `## Instructions` section | Softov, 2026-10-17, "make like a parser for the AGENTS.md? Extract ## Instructions ... only allow user to edit on ui the ## Instructions and what comes before", then "Yes, plan it" | 01, 02 |
| The frontmatter holds `version`, `name` and `description` | Softov, 2026-10-17, "AGENTS.md can have also a simple frontmatter, version, name, description?" | 01 |
| `version` is the version of the file's layout | (defaulted: a parser tells an old layout from a new one) | 01 |
| A section the bot removed reads as empty, and an edit in the UI writes it again | (defaulted: the bot owns the rest of the file and can break it) | 01 |
| The wire shape of a bot does not change, so a client needs no change | (defaulted: the provider reads the parts from the file) | 02 |
| A plugin reads YAML with the host's `parseYaml` and `stringifyYaml`, and has no YAML dependency of its own | Softov, 2026-10-17, "Server could expose the yaml call for plugins right?", then "plan and implement" | 06 |
| An edit to a computer bot while the computer is offline waits, and the next back session start writes it | Softov, 2026-10-17, "Its possible to make like a pending sync? For when offline?" | the bots plan *A bot runs in a machine*, task 04 |
| All the data of one bot is in `bots/<slug>/`, and a delete removes that folder | Softov, 2026-10-17, chose "One folder per bot" for "Deleting a bot leaves its rows in bot-chats/ and bot-sessions/, its chat logs, and its folder. Which fix?" | 05 |
| The record is `bots/<slug>/bot.md` in a `file` collection, and the chat and session rows are the collections `bots/<slug>/chats` and `bots/<slug>/sessions` | Softov, 2026-10-17, chose "Update and build" for "Update p8 task 05 to this design (collections at a subpath, three per bot) and build it?" | 05 |
| Task 03 waits, and task 04 does not wait for it | Softov, 2026-10-17, chose "Leave task 03 for later" | 03, 04 |
| The default `AGENTS.md` text stays as shipped in `template.ts` | Softov, 2026-11-02, chose "Keep the shipped text" | 01 |
| A bot file that comes back after its tombstone is refused, a problem line says the name is spent, and its folder is kept | Softov, 2026-11-03, chose "Refuse and report" | 07 |
| A load keeps a tombstoned folder that still holds `bot.md`, and reports it | (defaulted: a crash during a delete and a file put back look the same, and keeping the folder loses nothing) | 07 |
| A tombstone name that is not a slug is reported and removes nothing | (defaulted: the record collection already ignores such a name) | 07 |
| A file this host cannot read keeps the persona in the record, with a problem line | (defaulted: the move must not drop data it cannot write) | 08 |
| A make over an existing `AGENTS.md` writes the UI's parts into it, as an edit does | (defaulted: the person's entry is kept, and the bot's other text too) | 08 |
| The five low findings of the 2026-11-02 review are fixed in this plan | Softov, 2026-11-03, chose "Fix them in 52-p8" | 09 |
| Instructions with a line that starts with `## ` are refused, with the line named | (defaulted: a refusal changes nothing in silence; the section ends at a `##` line by design) | 09 |
| In the persona move, a file that has an Instructions section wins over the record | (defaulted: the file is the one copy) | 09 |
| A `root` option inside the config folder is refused at load | (defaulted: a delete of the data folder must never reach a work folder) | 09 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - AGENTS.md has parts the UI owns](task-01-agents-md-has-parts-the-ui-owns.md) | implemented | - |
| [02 - A bot's persona is read from and written to its AGENTS.md](task-02-the-persona-is-read-from-agents-md.md) | implemented | 01, 06 |
| [03 - An edit to a computer bot waits for the computer](task-03-an-edit-to-a-computer-bot-waits.md) | dropped | 02 |
| [04 - The docs say where a bot's persona is](task-04-the-docs-say-where-the-persona-is.md) | implemented | 02, 05 |
| [05 - A bot's data is one folder](task-05-a-bots-data-is-one-folder.md) | implemented | 02 |
| [06 - AGENTS.md uses the host's YAML](task-06-agents-md-uses-the-hosts-yaml.md) | done | 01 |
| [07 - A load removes only the data of a deleted bot](task-07-a-load-removes-only-dead-bots.md) | implemented | 05 |
| [08 - The persona is never dropped](task-08-the-persona-is-never-dropped.md) | todo | 02 |
| [09 - AGENTS.md text survives a write](task-09-agents-md-text-survives-a-write.md) | todo | 01 |
| [10 - The docs match the built bot](task-10-the-docs-match-the-built-bot.md) | todo | 04, 07, 08, 09 |

## Risks and tradeoffs

- The bot can rewrite its file in any shape. The parser takes what it finds and never refuses a file.
- A list of bots reads one file for each bot. A list is short, so this costs little.
- A computer bot shows its last known parts while the computer is offline. This needs task 04 of the bots plan *A bot runs in a machine*.

## Resume state

- **Done so far:** planned 2026-10-17. Tasks 01, 02, 04, 05 and 06 are implemented. The parser and the writer are in `packages/bot/src/agents.ts`, and the default text is in `packages/bot/src/template.ts`. `AGENTS.md` is the one copy of a bot's persona. A make writes the file from the template, and an edit writes the UI's parts into it. The store keeps no persona in a record it puts. At load, the store moves the persona of an older record into its file. Task 05 is implemented. A collection name is a path of one to three slugs, and the plugin claim is on the first slug. `CollectionOptions.file` keeps record `<id>` at `<name>/<id>/<file>.md`. All of one bot's data is in `<configDir>/bots/<slug>/`, with `bot.md`, `chats/`, `sessions/` and `logs/`. A load moves `bots/<slug>.md`, `bot-chats/` and `bot-sessions/` into the bot's folder. It removes the data of tombstoned bots, and reports a file it cannot place. A delete writes the tombstone and then removes `bots/<slug>/`; the bot's work folder is left alone. Task 07 is implemented. A load reads tombstone names through `isSlug`, keeps a tombstoned folder that still holds `bot.md`, and reports both. The store refuses an added or updated record whose slug has a tombstone, at the watch and at the load. Task 04 is implemented. `docs/plugins/BOTS.md` has a record file section and a persona section. The persona section says which parts of `AGENTS.md` the UI edits and which the bot owns. The record file and folder sections follow tasks 02 and 05. `packages/bot/test/bot-docs.test.ts` reads the page's `bot.md` sample as a record without the persona and its `AGENTS.md` sample through `readAgents`.
- **Next action:** build tasks 08 to 10, which fix what the review of 2026-11-02 found. Task 06 passed the review and is done. Task 07 is implemented and waits for review. Tasks 01, 02, 04 and 05 close with the fixes. Task 03 is dropped, and [deferred.md](deferred.md) says where it went.
- **Open questions:** none.
- **Watch out for:** read a bot through the store's `BotRecord` or `fromAgents`, and never as a raw collection record. A computer bot keeps its persona in its record until the bots plan *A bot runs in a machine*, task 04. A store with no YAML writes no file and keeps the persona in the record. The `bots` collection keeps `body: 'instructions'`, because an older record has its instructions in the Markdown body. `@cofold/yaml` is a `devDependency` of `packages/bot` for the tests only. One plugin owns a first slug and every path under it, so `bots/<slug>/chats` and `bots/<slug>/sessions` are opened by the bot plugin alone. A `file` collection lists only subfolders that hold `<file>.md`, so `chats/`, `sessions/` and `logs/` beside `bot.md` are not records. The chat agent scans every bot's `logs/` folder, because a log is found by its chat id and the folder says which bot. A wake finds a chat's bot by asking each bot's `chats` collection, since a message names only its session. A test host needs the plugin grant `session:trust`, or every back session start is refused naming the grant. The docs' paragraph on a computer bot describes the bots plan *A bot runs in a machine*, task 04, which is not built yet. Until it is, an offline edit of a computer bot does not wait.
