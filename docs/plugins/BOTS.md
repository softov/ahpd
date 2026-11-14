# Bots

A **bot** is a record a person keeps on the host, with a folder of its own, talked to in a chat of its own. `@ahpd/bot` serves it as the `bot:` scheme, so a bot is made, read, listed, edited and deleted through the same `resource*` methods every other resource uses - [RESOURCES.md](../sdk/RESOURCES.md).

A bot is not a backend of its own. It names whichever agent the host already has, by its `preset`, or by its `provider` and `model`, and the session a person talks to it in runs no model at all - [A talk and its Back chat](#a-talk-and-its-back-chat).

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
| `template` | The template its `AGENTS.md` is made from, by name. Absent is the default template - [The template](#the-template) |
| `provider` | The agent provider a session of it runs on, AHP's `provider`, where a bot chooses one |
| `model` | The model it asks for |
| `preset` | The session preset it starts from. Where one is set it wins over `provider` and `model` |
| `workspace` | The folder it works in, under `root`. Its own, and never moved |
| `computer` | The machine it runs in, where it names one |
| `connectors` | The connectors a session of it may use, by alias: `{ "work": "connectors://ap-resend/account-123" }`. An alias is a lowercase slug, and a value names one connector. Each talk with the bot reads the map live, so an edit reaches a Back chat that is already running, and a call after an alias is taken out fails - [An action offered as a tool](PLUGINS.md#an-action-offered-as-a-tool) |
| `owner` | Whose it is: `user:<id>`, `team:<team>`, `project:<team>:<project>` or `root:<host>`. A make may name the maker, or a team or project the maker belongs to; a holder of `*:*` may name any owner, this host's own `root:<host>` among them. A body naming anybody else is refused `-32009`, and an edit may not move it. Any `root:` is this host, whatever name follows it: one a make names is written under the host's name today, and a renamed machine keeps its bots. The manifest gives this host's own owner as a `const` in `owner`, so a client sends it as given |
| `createdAt`, `updatedAt` | The times. Read but never obeyed: what they hold is the host's |

Three of the fields in that table are the `AGENTS.md`'s rather than `bot.md`'s: `name`, `description` and `instructions`. The file is their one copy, a read answers them from it, and a make or an edit writes them there - [The persona](#the-persona). A bot on a computer keeps the three in its record, because its file is not on this host, and so does every bot of a store the host gives no YAML parser, which writes no file. Everything else that is the bot's is in the record file. A read also answers `session`, the reader's own talk with the bot, which belongs to the reader and is not kept in the record. A body that carries `session` back is taken, and the field is not kept: an older record's name for its back session is dropped the same way.

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
provider: claude
model: claude-sonnet-5
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
| `name` and `description` in the frontmatter, the keys VS Code's agent definitions carry | The UI, on a make or an edit |
| The text under `## Instructions`, up to the next `##` heading or the end of the file | The UI, on a make or an edit |
| Everything else: other frontmatter keys, other sections, comments | The bot |

With the plugin's `instructionsIn` at `body`, a bot's instructions are the whole body after the frontmatter instead, as VS Code reads an agent file: the body is the UI's, it may hold any line, and a template gives a bot its frontmatter alone, since the body a make writes is the instructions.

The UI changes only the parts in that table. A make or an edit replaces those frontmatter keys and the text of that section, and keeps every other byte of the file: a key a person or the bot put there, another section, a comment. The rest of the file is the bot's, and the bot may rewrite any of it. An edit or a make whose instructions hold a line that starts with `## ` is refused `-32602`, and the refusal names the line: the section would end there, and the rest of the instructions would read as another section.

A part the file does not have reads empty. A bot that removed its Instructions section is a bot with no instructions, and the next edit writes the section again. A read takes the parts from the file each time, so an edit the bot makes to its own file is what the next read answers. A watch and the catalogue hear a change to `bot.md`; a change to `AGENTS.md` alone is answered by the next read of the bot.

`CLAUDE.md` sits beside it with the one line `@AGENTS.md`, because Claude reads that name and not `AGENTS.md`; the import makes the two names one document.

A make fills the bot's template into the file: the `templates` record it names, or the default `AGENTS.md` template at `<configDir>/templates/bots/AGENTS.md`, which the daemon writes at load where it is absent and a person may edit. The filled text is copied into the bot's folder, once; an edit to the template reaches the next bot made and no bot that exists. A folder that already has an `AGENTS.md` keeps the file, because it is the bot's from its first moment: the make writes the bot's parts into it as an edit does, and the rest of what it says stays.

A folder with no `AGENTS.md` - one whose make failed to write it, or one a person emptied - gets the same text at the first wake of a Back chat. The file is the bot's rules: every harness reads it, and a wake never writes over a file that is there.

A bot on a computer keeps its persona in its record. Its `AGENTS.md` is on that computer, and the host neither reads nor writes it yet: a read answers the parts the record holds. An edit while the computer is offline does not wait yet either - it changes the record, and nothing writes it to the file when the computer is back. That wait is [A bot runs in a machine, task 04](../../.project/plans/bots/20261028-0545-a-bot-runs-in-a-machine/task-04-an-edit-to-a-bot-on-a-machine-waits.md).

## The slug

A bot's address is `bot://<slug>`, and the slug is the URI path, the record's `id` and the name of its folder - one thing written once. It is lowercase letters, digits and dashes, one to forty of them, starting with a letter; anything else is refused `-32602`, because the slug is a folder name and a URI path at once.

A slug is fixed when the bot is made and an edit cannot move it. A deleted slug is never made again: the host keeps a tombstone, and a make on one is refused `-32010`. A client held that address, and a different bot answering to it would be a lie about what that client has. A record that comes back after its delete is refused too: a load leaves it out and reports the spent name, and keeps its folder rather than removing what may be the person's own copy - [The record file](#the-record-file).

## The folder

A bot works in a folder of its own, `<root>/<slug>` unless the body named one, where `root` is the plugin's option and starts at `~/.bots`. No two bots share a folder and an edit never moves one: two bots in one tree would be two of them working over each other, so a body naming a folder another bot has is refused `-32602`. A folder a body names outside `root` is refused `-32009`, `Permission denied: <folder>`, as the protocol answers a path outside the allowed set. The folder is made when the bot is made, so a bot has one whether or not anybody has talked to it yet.

Its `AGENTS.md` is in that folder, with `CLAUDE.md` beside it - [The persona](#the-persona). A delete removes the daemon's own data for the bot, `<configDir>/bots/<slug>/`, and leaves the work folder and its `AGENTS.md` where they are: what a bot worked on is the person's to keep.

## Bodies and colours

The suggested bodies are `robot`, `humanoid`, `alien`, `gumbo`, `circle`, `semicircle`, `smash`, `square`, `triangle`, `pentagon`, `hexagon`, `drop`, `bean`, `cloud` and `ghost`. A body is a tag, so any other word is kept too, and a client draws a body it does not know with one of its own. A make with no body gets one of the fifteen at random. The colours are `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`, `brown`, `grey` and `black`. A colour may also be a hex colour, `#rrggbb`, which the host keeps in lowercase; `#fff` and `2f6fdf` are refused.

A make that names neither gets a body at random and the first colour.

## A talk and its Back chat

A person talks to a bot in a **talk**: a session of the `bot-chat` provider, which a client makes with `createSession`, naming the bot in its config, as a session of any agent is made:

```json
{ "method": "createSession", "params": { "channel": "ahp-session:/<uuid>", "provider": "bot-chat", "config": { "bot": "motion" } } }
```

A person has one talk with each bot, so the bot keeps what it did for them from one talk to the next. A second create for the same bot and person is refused with `You already have a session with <name>: <uri>.`, and the client opens that session from its session list. With the plugin's `secondSession` at `allow`, a person may open more than one, and the bot answers the one they used last. A session a plugin makes, such as the webhook's, is no person's and is never refused. A read of `bot://<slug>` answers the bot's record, with `session`, the reader's own talk, where they have one; it starts nothing, as VS Code's reads answer content. The talk is kept in the bot's `fronts/` rows, one for each bot and owner. The root counts as one person: every `root:<host>` owner shares one row, whatever machine the configuration runs on, and so does every talk on a host with no users. A session started again, by a restart or by a client opening its row, is never refused. A person who talked to a bot before the rows were kept has their last used talk with it written down the first time it is asked for.

The talk runs in the bot's `workspace`, trusted, with none of the settings of the person who runs the daemon, and on the bot's `computer` where it names one, whatever folder the client sent. Its default chat, the **Front**, runs no model, and keeps each turn as one JSON line under `<configDir>/bots/<slug>/logs/`, so a talk is still readable after a daemon restarts. It is titled with the bot's `name`. A turn it begins stays open until the plugin ends it, which is what the work behind the Front answers into.

A message said in the Front wakes its **Back**: a chat of the same session, on the bot's agent, which does the work and replies. Which bot a talk is with is its config's, and whose it is is the host's: the owner of the session, as the host recorded it at the create.

A Front's log is the whole of its state. Nothing about it is kept in memory past the process that made it, so a daemon that starts again lists, opens and replays the talks it has logs for. A turn the log shows begun and never ended, one a daemon went down in, is opened again when the daemon listens, and the bot is woken again, so its reply lands in that turn. The person's message reaches the Back a second time then, and the Back's own transcript shows it what the first time did. Where nothing answers a talk, the turn reads back as an error, as VS Code reads back a turn its record shows started and never ended: `executionInterrupted`, "The agent was interrupted before this request finished."

A talk's session, its Front and its row carry the bot in `_meta['ahpd.bot']`, namespaced as VS Code's host namespaces the keys it puts in `_meta`: `{ id, name, color, labels, body, kind: "direct" }`, the bot as it is now, or as the log's lines last had it for a bot since deleted. Each line of the log carries the same mark, so a listing says which bot a talk nothing runs is with.

### The Back a message wakes

A Front has one Back, found by its id: the chat of the session whose `tool` origin names the Front. The first message starts it on the bot's `preset`, or its `provider` and `model`, titled `@main/<bot>/<person>` and offered `post_message`; a bot that names neither runs it on the host's default agent. The Back's origin names the Front and the `subagent` call the Front turn shows, so a client draws it under that call, as a subagent's chat. The person is the talk owner's id, or `root` for the root, and `main` is one fixed word for now. With `policies.check` on, the Back's turns are checked and charged as the talk owner's, not as the plugin's. Every later message continues the same Back, and two messages that arrive together for one Front start one Back. A Back session an older daemon started stays as it is, and the next message starts a Back chat.

A message that reaches the wake is sent to the Back as a **queued** `chat/pendingMessageSet`, whatever the Back is doing, as VS Code's Agents window sends a message from one session into another: the host takes it up at once when the Back is idle, and after the turn in front of it otherwise. The message is an agent's (`origin: { kind: 'agent' }`), and its `_meta['vscode.chat.delegation']` names the talk's session and the Front. It names no model, agent or attachments, so the Back runs it on its own defaults; the Front keeps those with the person's message. The Front turn is answered by the turn the last message it sent becomes, and a stop of the Front turn takes back the messages still waiting in the Back and cancels its running turn.

Each woken message carries a context block in front of what the person said:

```text
<context>
main chat: <the URI of the Front the person is waiting in>
this chat: <the Back's agent-host-session:// link, which a subagent sends to>
from: <the person's id>
time: <ISO time with the host's offset>
</context>

<what the person said>
```

The block says what changes from message to message; the system prompt does not. The Front shows and keeps only the person's own words. With the plugin's `contextIn` at `meta`, the Back is handed the words as they were said, and the Front they came from only in the message's `_meta['vscode.chat.delegation']`, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L2615-L2621) delegates a prompt another session's agent wrote: the model reads no person or time then.

### What the Back answers with

The Front turn stays open while the Back works, and it shows the Back as a `subagent` tool call whose content opens the Back. The Back is writable: a turn the person types in it is that chat's own, as a turn VS Code's host starts is the turn of the chat it was started on, and the Front shows no turn for it. The call completes when the Back's turn completes, as VS Code completes a subagent's call with its work, whether or not the Back posted; a Front turn that is stopped or fails leaves it cancelled. Each time the Back calls `post_message`, the text is added to the turn the person is waiting on. The Back may post more than once, and the Front turn ends when the Back's turn ends. A message the person sends meanwhile waits in the Back's queue, and the Front turn then ends with the turn that message becomes. The tool is offered only to a Back, and it posts only to the Front the Back's origin names, so a chat cannot post into another one. It is marked as running without a confirmation, and a deny list a session carries still refuses it.

The Front is a chat, not a request: the Back reaches it at any time, not only while a message of the person's waits. A post that comes while no Front turn waits opens a turn of the bot's own, whose message has the protocol's origin `agent`, and the text lands there. That turn stays open while the Back runs a turn, and ends when that turn ends; a post while the Back runs none, such as one from a subagent working in the background, ends it at once. A subagent of the Back posts with the same tool: its calls run in the Back's process and name the Back. A turn the Back runs on its own, which no message started, such as the one the harness starts when a background task ends, says its last words in a turn of the bot's own as `mainTurnPostMessageAbsent` says, unless that is `notice` or `silence`. A turn a person types in the Back has a sender and stays in the Back.

A subagent messages its Back with the session tool `send_message`, which the Back is offered even where the root setting `sessionTools` is off. The `<context>` block of each message names the Back as `this chat`, an `agent-host-session://` link, for the Back to hand on. A call a subagent makes is refused only for the subagent's own chat, so it may name the Back.

The Back asks a question with its harness's question tool, and the question is shown in the Front; the answer given there goes back to the Back. So does a subagent of the Back: its question is in its worker chat, and the answer goes back there. A question that comes while no Front turn waits opens a turn of the bot's own, which ends once it is answered and the Back runs no turn. An approval is shown as a tool call waiting for a confirmation, and a request the Back withdraws leaves the Front. A harness with no question tool asks in the text it posts. With the plugin's `askIn` at `own`, nothing is copied: the request stays in the Back, and the talk's session lists it in its `inputNeeded`, naming the Back a client answers it in, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L19-L25) aggregates a subagent's requests on its session. The Back is a chat of that session, so the host lists it there; a Back session an older daemon started is listed there by the plugin.

The Back may also end its turn without posting. What the Front turn does then is the plugin's `mainTurnPostMessageAbsent`:

| Value | The Front turn |
| --- | --- |
| `post` | Ends with the final text of the Back's turn as the reply. A turn with no text ends with nothing. The default |
| `notice` | Ends with the notice `<bot name> finished without a reply` |
| `silence` | Ends with nothing |
| `postNotice` | Ends with the final text as the reply. A turn with no text ends with the notice |

A value outside those four is reported and `post` is used.

A message the wake cannot hand to a Back ends the Front turn failed, with `chat/error` and the reason, as VS Code ends a turn whose send failed: a talk whose bot has gone or whose session the host no longer holds, a Back the host would not start, a send the host refused, and a send the host did not answer in ten seconds, which ends the turn with VS Code's words for a message it sent into another session and did not hear back about: `Remote message delivery was not confirmed. It may already be queued; do not retry automatically.` It is not sent again. A Back turn that failed fails the Front turn the same way, typed `sendFailed`. A steer the wake cannot hand on is dropped instead, with the reason in the daemon's log, and the Front turn goes on waiting on the work it already waited on - [CHATS.md](../sdk/CHATS.md).

### The bot's rules

A Back's system prompt says only what no file can: that a person is waiting in the Front for its reply, that `post_message` is what answers them, that a question is asked with the harness's question tool, and that `send_message` starts a turn somewhere else and is not a reply. The bot's own rules are its `AGENTS.md`, which the harness reads: the template the bot names, or the shipped default `<configDir>/templates/bots/AGENTS.md`, filled with the bot's `name`, `description` and `instructions`. The file is written when the bot is made, and the first wake writes it where the folder has none; a wake never writes over a file that is there - [The persona](#the-persona).

## The template

A bot may name a `template`, the text its `AGENTS.md` is made from - [The persona](#the-persona). A bot that names none, or names one since removed, gets the default, which is a file: `<configDir>/templates/bots/AGENTS.md`, written at load where it is absent and edited by hand. A bot's `AGENTS.md` is that text with its words filled:

| Word | What it becomes |
| --- | --- |
| `{{name}}` | The bot's `name` |
| `{{description}}` | The bot's `description`, or nothing |
| `{{instructions}}` | The bot's `instructions`, or nothing |

A word that is not in this table is left as it was written.

A named template is a record in the `templates` collection, so the daemon keeps each one as a file: `<configDir>/templates/<name>.md`. Its frontmatter holds `title`, and its body is the text:

```markdown
---
title: Short
---

You are {{name}}. {{instructions}}
```

A bot names it as `template: short`. A make or an edit that names a template that does not exist is refused `-32602`, with a sentence that names it. An edit that does not name `template` passes even when the bot's template was deleted, and the bot keeps the name.

## Who may do what

| Who | What they may do |
| --- | --- |
| The owner | Read, edit, delete |
| A member of the owning team or project | Read, edit, delete |
| `bot:get` | Read any bot |
| `bot:chat` | Talk to any bot they may read |
| `bot:list` | List every bot |
| `bot:put` | Make a bot in the scheme, edit their own |
| `*:*` | Any of it, on any bot, and make a bot for any owner |
| A root connection | Any of it, on any bot |

A listing shows what a read would allow: a list that showed a bot the reader cannot open would be a list of names they cannot use.

A talk with a bot needs `bot:chat`, apart from reading it, unless the bot is the person's own: a member of the owning team or project reads the bot and needs the grant to talk to it. A person who may read a bot and not talk to it is answered `There is no bot <slug>.` A talk is a session, so it also needs what any session needs: the person's own `session:create`, the use of the `bot-chat` agent, which is the host's, and `chat:create` for its Back - [USERS.md](../sdk/USERS.md#roles).

## A watch

| Command | What it hears |
| --- | --- |
| `createResourceWatch bot://` | Every bot the reader may see |
| `createResourceWatch bot://<slug>` | That one bot |

A make is `added`, an edit is `updated` and a delete is `deleted`, one change per `resourceWatch/changed`.

A watcher hears only the bots it may read, by the table above, and a watch on `bot://` also hears every bot when the reader holds `bot:list`. Each reader subscribed to a watch has a watcher of their own, attached at their first subscribe, so a membership changed after that applies once their watcher is attached again.

A watch needs `bot:watch`, or a bot the reader may read: a watch on `bot://` is open to anybody signed in, and a watch on one bot to whoever may read it. A slug that does not exist is refused, as a read of it is.

## The catalogue

A client that subscribes to `x-ahpd-bots://` gets every bot it may read in one snapshot, then an action for each change. It reads the bots without one `resourceRead` per bot, and it hears changes that other clients make.

The snapshot state is `{ bots: BotRecord[] }`. Each record is the bot's own, the JSON object a write takes and a read answers. Three actions follow it:

| Action | When the client gets it |
| --- | --- |
| `{ type: 'x-ahpd-bots/added', bot: BotRecord }` | A bot was made that it may read, or a bot it did not have became readable |
| `{ type: 'x-ahpd-bots/changed', bot: BotRecord }` | A bot it has was edited, and it may still read it |
| `{ type: 'x-ahpd-bots/removed', id: string }` | A bot it has was deleted, or it may no longer read it. `id` is the slug |

When an edit changes whether a client may read the bot, that client gets `added` or `removed`, never `changed`. When the users file changes, each subscriber gets `added` and `removed` for the bots its memberships gave or took away. Only that subscriber gets them.

Each client gets only the actions about bots it may read, so it sees gaps in `serverSeq` on this channel. A client cannot dispatch an action to the channel.

The channel's grant is `bot:read`. A reader without it is let in all the same, as VS Code serves each client its own projection of a list: it sees the bots it may read, none at first for a reader who may read none, and an `added` for each that becomes readable to it. `bot:get` reads every bot, so a holder of `bot:read` sees them all.

The channel is in `_meta['ahpd.channels']` on `initialize` and on the root state, as `{ scheme: 'x-ahpd-bots', title: 'Bots', description, grant: 'bot:read' }`. [PLUGINS.md](PLUGINS.md#a-channel-of-your-own) describes a plugin channel.

## An example

A make from a name alone, which is the whole of what is required:

```json
{ "name": "Motion" }
```

A bot that runs on a provider of its own, with something to be:

```json
{
  "name": "Motion",
  "labels": ["review", "ci"],
  "description": "Reads pull requests and says what would break.",
  "body": "robot",
  "color": "teal",
  "instructions": "You review pull requests. Say what would break, in one paragraph.",
  "provider": "claude",
  "model": "claude-sonnet-5"
}
```

An edit that asks for a provider, leaving everything else as it was:

```json
{ "provider": "claude", "model": "claude-sonnet-5" }
```

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `root` | `~/.bots` | The folder a bot's workspace is under, as `<root>/<slug>`. A root that is the configuration folder or under it is refused at load, with a problem line, and the default is used |
| `mainTurnPostMessageAbsent` | `post` | What a Front turn does when the Back's turn ends without `post_message`: `post`, `notice`, `silence` or `postNotice` |
| `instructionsIn` | `section` | Where a bot's instructions are in its `AGENTS.md`: `section`, its `## Instructions` section, or `body`, the whole body after the frontmatter, as VS Code reads an agent file - [The persona](#the-persona) |
| `contextIn` | `text` | Where a woken message's context goes: `text`, a block in front of the person's words, or `meta`, the words as said with the Front in the message's delegation `_meta` alone, as VS Code delegates a prompt - [The Back a message wakes](#the-back-a-message-wakes) |
| `askIn` | `main` | Where the Back's question or approval is shown: `main`, copied into the Front turn and answered there, or `own`, left in the Back and listed on the talk's `inputNeeded`, as VS Code lists a subagent's requests on its session - [What the Back answers with](#what-the-back-answers-with) |
| `secondSession` | `refuse` | What a person's second session with the same bot gets: `refuse`, refused naming their talk, or `allow`, opened, and the bot answers the one they used last - [A talk and its Back chat](#a-talk-and-its-back-chat) |

```json
{ "plugins": [{ "name": "@ahpd/bot", "options": { "root": "/srv/bots" } }] }
```

The plugin's own entry needs `session:read` and `session:write`. A message is sent to a Back as a client's chat action, which `session:write` covers, and the session's state is read with `session:read`. A talk runs in the bot's folder, trusted, and needs no grant for it: the plugin registers its `root` as its own folder.

```json
{ "plugins": [{ "name": "@ahpd/bot", "grants": ["session:read", "session:write"], "options": { "root": "/srv/bots" } }] }
```

All the data of one bot is in `<configDir>/bots/<slug>/`: its record is `bot.md` - [The record file](#the-record-file) shows one - its Front rows are in `fronts/`, the rows of the Back sessions an older daemon started in `sessions/`, and its talk logs in `logs/`. A delete removes that folder. The tombstones are in `<configDir>/bots-gone/`. Named templates are in `<configDir>/templates/<name>.md`, and the default `AGENTS.md` template is `<configDir>/templates/bots/AGENTS.md`. A bot's `AGENTS.md` is not in the configuration folder: it is in the bot's work folder, which the `root` option places - [The persona](#the-persona). A plugin that takes the record store over keeps the records and the tombstones wherever that store keeps them; the work folder and its `AGENTS.md` stay where they are.

## See also

| | |
| --- | --- |
| [RESOURCES.md](../sdk/RESOURCES.md) | What a scheme is, and the grants each resource method asks for |
| [SESSIONS.md](../sdk/SESSIONS.md) | What a session is and who it is charged to |
| [COMPUTERS.md](COMPUTERS.md) | Making a machine, and running a session inside it |
| [PLUGINS.md](PLUGINS.md) | Writing a plugin, and starting a session as an owner |
