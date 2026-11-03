# Bots

A **bot** is a record a person keeps on the host, with a folder of its own, talked to in a chat of its own. `@ahpd/bot` serves it as the `bot:` scheme, so a bot is made, read, listed, edited and deleted through the same `resource*` methods every other resource uses - [RESOURCES.md](../sdk/RESOURCES.md).

A bot is not a backend of its own. It names whichever harness the host already has, by its `preset`, or by its `harness` and `model`, and the chat a person talks to it in runs no model at all - [The chat and its back sessions](#the-chat-and-its-back-sessions).

## The record

| Field | What it is |
| --- | --- |
| `id` | The slug. Read but never obeyed: it is the URI path, and a body naming another one is refused |
| `name` | What a person called it. The only field a make must carry |
| `labels` | Words a client groups bots by. Two bots may share one |
| `description` | One line about it, for a list of bots |
| `body` | Which body it is drawn with. Any word: the fifteen below are the suggestions |
| `color` | Which colour it is drawn in: one of the eleven below, or a hex colour `#rrggbb` |
| `instructions` | What it was asked to be, in its own words |
| `template` | The template a chat with it would open with, and the text its `AGENTS.md` is made from, by name. Absent is the default template - [The template](#the-template) |
| `harness` | The backend a session of it runs on, where a bot chooses one |
| `model` | The model it asks for |
| `preset` | The session preset it starts from. Where one is set it wins over `harness` and `model` |
| `workspace` | The folder it works in, under `root`. Its own, and never moved |
| `session` | The name of the back session a message wakes. `work` where absent, and a name with `{turn}` in it starts one session per message |
| `computer` | The machine it runs in, where it names one |
| `connectors` | The connectors a session of it may use, by alias: `{ "work": "connectors://ap-resend/account-123" }`. An alias is a lowercase slug, and a value names one connector. Each back session the bot started reads the map live, so an edit reaches a session that is already running, and a call after an alias is taken out fails - [An action offered as a tool](PLUGINS.md#an-action-offered-as-a-tool) |
| `owner` | Whose it is: `user:<id>`, `team:<team>`, `project:<team>:<project>` or `root:<host>`. A make may name the maker, or a team or project the maker belongs to; a holder of `*:*` may name any owner, this host's own `root:<host>` among them. A body naming anybody else is refused `-32009`, and an edit may not move it. Any `root:` is this host, whatever name follows it: one a make names is written under the host's name today, and a renamed machine keeps its bots. The manifest gives this host's own owner as a `const` in `owner`, so a client sends it as given |
| `chat` | The reader's own chat with this bot. Answered by a read and never obeyed: it is a different conversation for each reader, so what a body carries is not kept - [The chat and its back sessions](#the-chat-and-its-back-sessions) |
| `createdAt`, `updatedAt` | The times. Read but never obeyed: what they hold is the host's |

Three of the fields in that table are the `AGENTS.md`'s rather than `bot.md`'s: `name`, `description` and `instructions`. The file is their one copy, a read answers them from it, and a make or an edit writes them there - [The persona](#the-persona). A bot on a computer keeps the three in its record, because its file is not on this host, and so does every bot of a store the host gives no YAML parser, which writes no file. Everything else that is the bot's is in the record file; `chat` belongs to the reader, and is not kept in the record.

A body that names a key a bot does not have is refused `-32602`, and so is a `body` that is not a word or a `color` that is neither a name below nor `#rrggbb`. So is a `connectors` map that is not an object, an alias that is not a lowercase slug, or a value that is not `connectors://<adapter>/<id>`: those are the two checks the host makes when it reads a session's bindings, and a bot is written once and read on every message.

## The record file

Each bot has a folder of its own in the daemon's configuration, `<configDir>/bots/<slug>/`. Its record is `bot.md`, the fields as YAML frontmatter between two `---` lines; the host writes nothing below them. A bot on a computer, and every bot of a store with no YAML, also keeps `name` and `description` in that frontmatter and its `instructions` below it, because there is no file of this host's to read them from - [The persona](#the-persona). The folder name is the `id`, and a record whose frontmatter names another one is reported and left out. The bot's rows and logs are in that folder too - [Options](#options) says where.

```md
---
id: motion
labels:
  - review
  - ci
body: robot
color: teal
harness: claude
model: claude-sonnet-5
session: work
workspace: /srv/bots/motion
owner: user:soft
createdAt: 2026-10-11T09:00:00.000Z
updatedAt: 2026-10-11T09:00:00.000Z
---
```

A daemon that starts after an upgrade moves what an older one left: `bots/<slug>.md` becomes `bots/<slug>/bot.md`, and the rows and logs in `bot-chats/` and `bot-sessions/` move into the folder of their bot. A file the move cannot place is reported and left where it is. What is left of a deleted bot is removed, except a folder that still holds its `bot.md`: a delete that died between its steps and a file put back after one look the same, so the folder is kept and reported.

A record made before `AGENTS.md` was the one copy of a bot's persona still carries its parts. A load moves them into the file and puts the record back without them, once a read of the file gives them back. A file that already has an Instructions section keeps it, and the record's copy is dropped. A file the load cannot read is left alone: the persona stays in the record, and the load reports it - [The persona](#the-persona).

A `bot.md` a person edits is read while the daemon runs, and the change reaches watchers and the catalogue as any other edit does. Two fields an edit by hand may not change:

| Field | What happens |
| --- | --- |
| `owner` | The bot keeps the owner it had, and the change is reported |
| `workspace` | The bot keeps its folder, and the change is reported |

A file that is not a bot record - a field of the wrong type, or a colour that is neither one of the eleven nor `#rrggbb` - is reported in the same way, and the bot reads as it did before the edit.

## The persona

A bot's persona - its `name`, `description` and `instructions` - is its `AGENTS.md`, in the bot's work folder. The folder starts at `<root>/<slug>`, which is `~/.bots/<slug>` by default, so the file is `<root>/<slug>/AGENTS.md` - [The folder](#the-folder). The file is the one copy: a read answers those three fields from it, and a make or an edit writes them there. The wire shape does not change, so a client sends and receives them on the record as it always did.

The file has a frontmatter and an `## Instructions` section, and everything else in it is the bot's own writing:

```md
---
version: 1
name: Motion
description: Reads pull requests and says what would break.
---

## Instructions

You review pull requests. Say what would break, in one paragraph.

## How you work

This file is your rules. You are Motion, a persistent bot assistant on `ahpd`, and this folder is yours. Answer as Motion, not as the model or the program that runs you. The frontmatter and the Instructions section are your owner's. You may change them only when your owner asks.

If the Instructions section does not say what you are for, ask the person who talks to you. Ask what work you do, for whom, and what you must never do. Then write their answers in the Instructions section.
```

| Part | Who edits it |
| --- | --- |
| `version`, `name` and `description` in the frontmatter | The UI, on a make or an edit |
| The text under `## Instructions`, up to the next `##` heading or the end of the file | The UI, on a make or an edit |
| Everything else: other frontmatter keys, other sections, comments | The bot |

`version` names the layout of the file, so a reader can tell an older one from a newer one. A write that names no version keeps the one the file names, and writes 1 where it names none.

The UI changes only the parts in that table. A make or an edit replaces those frontmatter keys and the text of that section, and keeps every other byte of the file: a key a person or the bot put there, another section, a comment. The rest of the file is the bot's, and the bot may rewrite any of it. An edit or a make whose instructions hold a line that starts with `## ` is refused `-32602`, and the refusal names the line: the section would end there, and the rest of the instructions would read as another section.

A part the file does not have reads empty. A bot that removed its Instructions section is a bot with no instructions, and the next edit writes the section again. A read takes the parts from the file each time, so an edit the bot makes to its own file is what the next read answers. A watch and the catalogue hear a change to `bot.md`; a change to `AGENTS.md` alone is answered by the next read of the bot.

`CLAUDE.md` sits beside it with the one line `@AGENTS.md`, because Claude reads that name and not `AGENTS.md`; the import makes the two names one document.

A make fills the bot's template into the file: the `templates` record it names, or the default `AGENTS.md` template at `<configDir>/templates/bots/AGENTS.md`, which the daemon writes at load where it is absent and a person may edit. The filled text is copied into the bot's folder, once; an edit to the template reaches the next bot made and no bot that exists. A folder that already has an `AGENTS.md` keeps the file, because it is the bot's from its first moment: the make writes the bot's parts into it as an edit does, and the rest of what it says stays.

A folder with no `AGENTS.md` - one whose make failed to write it, or one a person emptied - gets the same text at the first wake of a back session. The file is the bot's rules: every harness reads it, and a wake never writes over a file that is there.

A bot on a computer keeps its persona in its record. Its `AGENTS.md` is on that computer, and the host neither reads nor writes it yet: a read answers the parts the record holds. An edit while the computer is offline does not wait yet either - it changes the record, and nothing writes it to the file when the computer is back. That wait is [A bot runs in a machine, task 04](../../.project/plans/bots/20261028-0545-a-bot-runs-in-a-machine/task-04-an-edit-to-a-bot-on-a-machine-waits.md).

## The slug

A bot's address is `bot://<slug>`, and the slug is the URI path, the record's `id` and the name of its folder - one thing written once. It is lowercase letters, digits and dashes, one to forty of them, starting with a letter; anything else is refused `-32602`, because the slug is a folder name and a URI path at once.

A slug is fixed when the bot is made and an edit cannot move it. A deleted slug is never made again: the host keeps a tombstone, and a make on one is refused `-32010`. A client held that address, and a different bot answering to it would be a lie about what that client has. A record that comes back after its delete is refused too: a load leaves it out and reports the spent name, and keeps its folder rather than removing what may be the person's own copy - [The record file](#the-record-file).

## The folder

A bot works in a folder of its own, `<root>/<slug>` unless the body named one, where `root` is the plugin's option and starts at `~/.bots`. No two bots share a folder and an edit never moves one: two bots in one tree would be two of them working over each other, so a body naming a folder another bot has is refused `-32602`. The folder is made when the bot is made, so a bot has one whether or not anybody has talked to it yet.

Its `AGENTS.md` is in that folder, with `CLAUDE.md` beside it - [The persona](#the-persona). A delete removes the daemon's own data for the bot, `<configDir>/bots/<slug>/`, and leaves the work folder and its `AGENTS.md` where they are: what a bot worked on is the person's to keep.

## Bodies and colours

The suggested bodies are `robot`, `humanoid`, `alien`, `gumbo`, `circle`, `semicircle`, `smash`, `square`, `triangle`, `pentagon`, `hexagon`, `drop`, `bean`, `cloud` and `ghost`. A body is a tag, so any other word is kept too, and a client draws a body it does not know with one of its own. A make with no body gets one of the fifteen at random. The colours are `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`, `brown`, `grey` and `black`. A colour may also be a hex colour, `#rrggbb`, which the host keeps in lowercase; `#fff` and `2f6fdf` are refused.

A make that names neither gets a body at random and the first colour.

## The chat and its back sessions

A person talks to a bot in a **chat**: one session of the `bot-chat` provider per bot and person. That provider runs no model, and keeps each turn as one JSON line under `<configDir>/bots/<slug>/logs/`, so a chat is still readable after a daemon restarts. A turn it begins stays open until the plugin ends it, which is what the work behind the chat answers into.

A message said in the chat wakes a **back session**: an ordinary session of the host, on the bot's harness, which does the work and replies. The chat is the person's main chat with the bot, and each back session is behind it. Their two names are:

| Name | What it is |
| --- | --- |
| `bot:/<bot>/<user>` | One person's main chat with one bot. A read answers `{ chat }`, the session the chat is in |
| `bot:/<bot>/<user>/<name>` | One back session behind that chat. A read answers `{ session }`, the session that name is on today, and "not found" when no row has the name |

`bot:/<bot>/<user>/` is a directory, and a list of it answers the names of that person's back sessions. `bot:/` and `bot://` are the same address.

`<user>` is the id after `user:`, so `user:ana` is `ana` in the path. A reader who is nobody is this host, named after the machine, so a host with no users directory has a main chat of its own.

A read of the main chat is answered to the person it is named for, to the bot's owner and to this host. A reader who is none of those is refused, because a chat is one person's conversation rather than part of the record. Reading one's own main chat also needs `bot:chat` unless the bot is theirs, as a read of the bot does, and the first read starts the chat the way a read of the bot does. A back session and a list of the names are answered to those same three.

A chat is opened by a **read**. `resourceRead bot://<slug>` answers the record with one more key, `chat`, the URI of the reader's own conversation with that bot, and the first read by a reader who may chat starts it and keeps the row. Reading the same bot again answers the same chat, and two people reading one bot are answered two different chats. A reader who may not chat is answered the record alone: no `chat` key and no refusal, because there is nothing wrong with their read - there is simply no conversation of theirs to name.

A chat is the reader's own session: it works in the bot's `workspace`, it is titled with the bot's `name`, and starting one needs the reader's own `session:create`, asked by the host the way it is asked at the door. A refusal there is the read's refusal.

`chat` is answered and never obeyed. A client that read a bot and writes the record back, `chat` and all, is writing what it was given, and the key is dropped rather than kept: a chat is the reader's, and the next reader's read answers the next reader's chat.

A chat's log is the whole of its state. Nothing about a chat is kept in memory past the process that made it, so a daemon that starts again lists, opens and replays the chats it has logs for.

### The name a message wakes

The bot's `session` names the back session a message goes to. It is `work` unless the bot says otherwise, and it may hold `{turn}`: the turn id of the message takes that word's place, so a bot that names `{turn}` starts a back session for each message rather than continuing one. A name is up to 40 lowercase letters, digits and dashes, starting with a letter, and `{turn}` may stand anywhere in it; a make that names anything else is refused `-32602`.

A message that reaches the wake is sent to its back session as a **queued** `chat/pendingMessageSet`, whatever the session is doing, as VS Code's Agents window sends a message from one session into another: the back session's host takes it up at once when the session is idle, and after the turn in front of it otherwise. The message is an agent's (`origin: { kind: 'agent' }`), and its `_meta['vscode.chat.delegation']` names the main chat's session and chat. It names no model, agent or attachments, so the back session runs it on its own defaults; the main chat keeps those with the person's message. The main turn is answered by the turn the last message it sent becomes, and a stop of the main turn takes back the messages still waiting in the back session. A back session is started on the bot's `preset`, or its `harness` and `model`, in the bot's folder, owned by the person of the main chat, and titled with the bot's name. It loads none of the settings of the person who runs the daemon: the bot's rules are its own `AGENTS.md`, not the operator's.

The session a name is on is kept in the bot's own `sessions/` rows, so a message that comes back to an idle name continues the session it started. A name whose session the host no longer has - a daemon that restarted - is started again and the row written over. Two messages that arrive together for one name start one session.

Each woken message carries a context block in front of what the person said:

```text
<context>
main chat: bot:/<bot>/<user>
from: <the person's id>
time: <ISO time with the host's offset>
</context>

<what the person said>
```

The block says what changes from message to message; the system prompt does not. The main chat shows and keeps only the person's own words.

### What the back session answers with

The main turn stays open while the back session works, and it shows the back session as a `subagent` tool call whose content opens the back session's chat. It ends when the back session calls `post_message` with the reply: that text becomes the response of the turn the person is waiting on. The tool is offered only to a back session, and it posts only to the main chat that woke the calling session, so a back session cannot post into another chat. It is marked as running without a confirmation, and a deny list a session carries still refuses it.

A back session asks a question with its harness's question tool, and the question is shown in the main chat; the answer given there goes back to the back session. An approval is shown as a tool call waiting for a confirmation, and a request the back session withdraws leaves the main chat. A harness with no question tool asks in the text it posts.

A back session may also end its turn without posting. What the main turn does then is the plugin's `mainTurnPostMessageAbsent`:

| Value | The main turn |
| --- | --- |
| `post` | Ends with the final text of the back session's turn as the reply. A turn with no text ends with nothing. The default |
| `notice` | Ends with the notice `<bot name> finished without a reply` |
| `silence` | Ends with nothing |
| `postNotice` | Ends with the final text as the reply. A turn with no text ends with the notice |

A value outside those four is reported and `post` is used.

### The bot's rules

A back session's system prompt says only what no file can: that a person is waiting in the main chat for its reply, that `post_message` is what answers them, that a question is asked with the harness's question tool, and that `send_message` starts a turn somewhere else and is not a reply. The bot's own rules are its `AGENTS.md`, which the harness reads: the template the bot names, or the shipped default `<configDir>/templates/bots/AGENTS.md`, filled with the bot's `name`, `description` and `instructions`. The file is written when the bot is made, and the first wake writes it where the folder has none; a wake never writes over a file that is there - [The persona](#the-persona).

## The template

A bot may name a `template`, which is what a chat with it would open with and the text its `AGENTS.md` is made from - [The persona](#the-persona). A bot that names none gets the default one the plugin ships:

```text
You are {{name}}. {{description}}

{{instructions}}

## Your last chats

{{chats}}
```

| Word | What it becomes |
| --- | --- |
| `{{name}}` | The bot's `name` |
| `{{description}}` | The bot's `description`, or nothing |
| `{{instructions}}` | The bot's `instructions`, or nothing |
| `{{chats}}` | One line `- <title>` per chat the bot is in, newest first, at most `lastChats` of them. `None.` when there are none |

A word that is not in this table is left as it was written.

The default `AGENTS.md` template is a second text, and it is a file rather than a record: `<configDir>/templates/bots/AGENTS.md`, written at load where it is absent and edited by hand. A bot's `AGENTS.md` is the text its `template` names, or that file, filled with `{{name}}`, `{{description}}` and `{{instructions}}` - [The persona](#the-persona). A word outside those three, `{{chats}}` among them, is left as it was written, because the file is the bot's rules rather than the opening of a conversation.

A named template is a record in the `templates` collection, so the daemon keeps each one as a file: `<configDir>/templates/<name>.md`. Its frontmatter holds `title`, and its body is the text:

```markdown
---
title: Short
---

You are {{name}}. {{instructions}}
```

A bot names it as `template: short`. A make or an edit that names a template that does not exist is refused `-32602`, with a sentence that names it. An edit that does not name `template` passes even when the bot's template was deleted, and the bot keeps the name.

Nothing fills a chat template yet. A chat runs no model, so there is no first turn for one to open, and what a template reaches is decided with the work a bot does.

## Who may do what

| Who | What they may do |
| --- | --- |
| The owner | Read, edit, delete |
| A member of the owning team or project | Read, edit, delete |
| `bot:get` | Read any bot |
| `bot:list` | List every bot |
| `bot:put` | Make a bot in the scheme, edit their own |
| `bot:chat` | Be answered a chat by any bot they may read |
| `*:*` | Any of it, on any bot, and make a bot for any owner |
| A root connection | Any of it, on any bot |

A listing shows what a read would allow: a list that showed a bot the reader cannot open would be a list of names they cannot use.

A read that opens a chat also needs the reader's own `session:create`, because the chat is theirs rather than the bot's - [USERS.md](../sdk/USERS.md#roles).

## A watch

| Command | What it hears |
| --- | --- |
| `createResourceWatch bot://` | Every bot the reader may see |
| `createResourceWatch bot://<slug>` | That one bot |

A make is `added`, an edit is `updated` and a delete is `deleted`, one change per `resourceWatch/changed`.

A watcher hears only the bots it may read, by the table above, and a watch on `bot://` also hears every bot when the reader holds `bot:list`. The reader is the one that opened the watch, so a membership changed after that applies at the next watch.

A watch needs `bot:watch`, or a bot the reader may read: a watch on `bot://` is open to anybody signed in, and a watch on one bot to whoever may read it. A slug that does not exist is refused, as a read of it is.

## The catalogue

A client that subscribes to `x-ahpd-bots://` gets every bot it may read in one snapshot, then an action for each change. It reads the bots without one `resourceRead` per bot, and it hears changes that other clients make.

The snapshot state is `{ bots: BotRecord[] }`. Each record is the bot's own, the JSON object a write takes and a read answers, without `chat` - a chat belongs to whoever read the bot, and the catalogue is one snapshot for the whole client. Three actions follow it:

| Action | When the client gets it |
| --- | --- |
| `{ type: 'x-ahpd-bots/added', bot: BotRecord }` | A bot was made that it may read, or a bot it did not have became readable |
| `{ type: 'x-ahpd-bots/changed', bot: BotRecord }` | A bot it has was edited, and it may still read it |
| `{ type: 'x-ahpd-bots/removed', id: string }` | A bot it has was deleted, or it may no longer read it. `id` is the slug |

When an edit changes whether a client may read the bot, that client gets `added` or `removed`, never `changed`. When the users file changes, each subscriber gets `added` and `removed` for the bots its memberships gave or took away. Only that subscriber gets them.

Each client gets only the actions about bots it may read, so it sees gaps in `serverSeq` on this channel. A client cannot dispatch an action to the channel.

A subscribe needs `bot:read`. Without it, a reader who may read at least one bot is let in, and sees the bots it may read. `bot:get` reads every bot, so a holder of `bot:read` sees them all.

The channel is in `_meta['ahpd.channels']` on `initialize` and on the root state, as `{ scheme: 'x-ahpd-bots', title: 'Bots', description, grant: 'bot:read' }`. [PLUGINS.md](PLUGINS.md#a-channel-of-your-own) describes a plugin channel.

## An example

A make from a name alone, which is the whole of what is required:

```json
{ "name": "Motion" }
```

A bot that runs on a harness of its own, with something to be:

```json
{
  "name": "Motion",
  "labels": ["review", "ci"],
  "description": "Reads pull requests and says what would break.",
  "body": "robot",
  "color": "teal",
  "instructions": "You review pull requests. Say what would break, in one paragraph.",
  "harness": "claude",
  "model": "claude-sonnet-5"
}
```

An edit that asks for a harness, leaving everything else as it was:

```json
{ "harness": "claude", "model": "claude-sonnet-5" }
```

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `root` | `~/.bots` | The folder a bot's workspace is under, as `<root>/<slug>`. A root that is the configuration folder or under it is refused at load, with a problem line, and the default is used |
| `lastChats` | `10` | How many chats `{{chats}}` lists |
| `mainTurnPostMessageAbsent` | `post` | What a main turn does when the back session's turn ends without `post_message`: `post`, `notice`, `silence` or `postNotice` |

```json
{ "plugins": [{ "name": "@ahpd/bot", "options": { "root": "/srv/bots" } }] }
```

The plugin's own entry needs `session:read` and `session:write`. A message is sent to a back session as a client's chat action, which `session:write` covers, and the session's state is read with `session:read`. The write group also holds `session:trust`, which the trusted start of a back session asks for; without the grant the start is refused, and the main turn ends with a notice naming what was refused.

```json
{ "plugins": [{ "name": "@ahpd/bot", "grants": ["session:read", "session:write"], "options": { "root": "/srv/bots" } }] }
```

All the data of one bot is in `<configDir>/bots/<slug>/`: its record is `bot.md` - [The record file](#the-record-file) shows one - its main chat rows are in `chats/`, its back session rows in `sessions/`, and its chat logs in `logs/`. A delete removes that folder. The tombstones are in `<configDir>/bots-gone/`. Named templates are in `<configDir>/templates/<name>.md`, and the default `AGENTS.md` template is `<configDir>/templates/bots/AGENTS.md`. A bot's `AGENTS.md` is not in the configuration folder: it is in the bot's work folder, which the `root` option places - [The persona](#the-persona). A plugin that takes the record store over keeps the records and the tombstones wherever that store keeps them; the work folder and its `AGENTS.md` stay where they are.

## See also

| | |
| --- | --- |
| [RESOURCES.md](../sdk/RESOURCES.md) | What a scheme is, and the grants each resource method asks for |
| [SESSIONS.md](../sdk/SESSIONS.md) | What a session is and who it is charged to |
| [COMPUTERS.md](COMPUTERS.md) | Making a machine, and running a session inside it |
| [PLUGINS.md](PLUGINS.md) | Writing a plugin, and starting a session as an owner |
