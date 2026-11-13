---
title: Bots
status: current
covers:
  - packages/bot/src/**
decisions:
  - decisions/a-bot-record-stays-in-config.md
refs:
  - "[code://packages/bot/src/plugin.ts#L47-L82](../../packages/bot/src/plugin.ts#L47-L82) - `apply`, where the store, the preamble, the catalogue and the `bot` provider are wired"
  - "[code://packages/bot/src/record.ts#L172-L175](../../packages/bot/src/record.ts#L172-L175) - `colour`, a name from the list or a six-digit hex"
  - "[code://packages/bot/src/record.ts#L204-L255](../../packages/bot/src/record.ts#L204-L255) - `checkRecord`, the checks on a bot record"
  - "[code://packages/bot/src/provider.ts#L176-L204](../../packages/bot/src/provider.ts#L176-L204) - `manifest`, the schema that names this host as an owner"
  - "[code://packages/bot/src/provider.ts#L213-L253](../../packages/bot/src/provider.ts#L213-L253) - `mayRead` and `mayWrite`"
  - "[code://packages/bot/src/provider.ts#L318-L358](../../packages/bot/src/provider.ts#L318-L358) - `ownerFor`, the owner a write gives a bot"
  - "[code://packages/bot/src/provider.ts#L372-L391](../../packages/bot/src/provider.ts#L372-L391) - `mayLink` and `workspaceFor`"
  - "[code://packages/bot/src/provider.ts#L471-L547](../../packages/bot/src/provider.ts#L471-L547) - `write`, make and edit of a bot"
  - "[code://packages/bot/src/provider.ts#L562-L574](../../packages/bot/src/provider.ts#L562-L574) - `remove`, which leaves a tombstone"
  - "[code://packages/bot/src/wake.ts](../../packages/bot/src/wake.ts) - `backOf`, the Back chat of a Front, found by its origin or started"
  - "[code://packages/bot/src/talks.ts](../../packages/bot/src/talks.ts) - `botTalks`, the one talk for each bot and person"
  - "[code://packages/bot/src/chat.ts](../../packages/bot/src/chat.ts) - `botChatAgent`: `placeSession`, the one-talk refusal, and the turn a restart left open"
  - "[code://packages/bot/src/template.ts#L59-L67](../../packages/bot/src/template.ts#L59-L67) - `firstTurn`, the filled template for each new chat"
  - "[code://packages/bot/src/catalogue.ts#L68-L193](../../packages/bot/src/catalogue.ts#L68-L193) - `botCatalogue`, the `x-ahpd-bots://` channel"
  - "[code://packages/bot/src/store.ts#L97-L244](../../packages/bot/src/store.ts#L97-L244) - `botStore`, the cache over the host record store"
  - git://d9d4f950^ - the deleted decisions this spec was written from: a-bot-colour-is-a-name-or-a-hex, a-bot-from-a-profile-gets-its-own-machine-and-a-named-machine-is-shared, a-bot-gets-its-session-by-a-link-or-at-make, a-bot-keeps-its-own-agent-state, a-bot-owns-one-folder, bot-records-live-in-the-bot-plugin, bots-are-watched-and-catalogued, the-bot-manifest-names-the-host-owner
---

The bot plugin `@ahpd/bot` (plugin id `bot`) gives a named agent a record, an owner, one folder and one session.
It serves the `bot:` scheme for each record and the `x-ahpd-bots://` channel for the list of bots a reader may read.
A record is a Markdown file in the host record store, at `<configDir>/bots/<slug>.md`: YAML frontmatter, with the instructions as the body.
A removed bot leaves a tombstone in the `bots-gone` collection, so its slug is not used again.
Each new chat of a bot's session opens with the bot's template, filled again from the record and the last chats.
The code is in [`code://packages/bot/src/provider.ts`](../../packages/bot/src/provider.ts) and the files next to it.

## Scenarios

### A person makes a bot

WHEN a person writes `bot://<slug>` with a name
AND the slug is a lowercase slug of at most 40 characters that no bot or tombstone holds
THEN the plugin makes the bot's folder, when the bot names no computer
AND starts no session.
The record has no `session` field. A body that has one is accepted, and the plugin does not keep the field.

### A person talks to a bot

WHEN a client creates a `bot-chat` session that names the bot
AND the reader owns the bot or holds `bot:chat`
THEN the session runs in the bot's folder, trusted, with no user settings, on the bot's computer
AND the plugin writes the session in the bot's `fronts` rows, one row for each bot and person.
WHEN the same person creates a second session with that bot
THEN the plugin refuses it and names the first session, unless the option `secondSession` is `allow`.
A session that a plugin creates is not refused.
WHEN a person reads `bot://<slug>`
THEN the answer has `session`, the person's own talk, when the host still holds it.

### The Back of a talk

WHEN a message arrives in the Front, which is the default chat of a talk
THEN the plugin sends it to the Back: the chat of the same session whose `tool` origin names the Front
AND starts the Back with `startChat` when there is none, on the preset, or on the provider and the model.
The origin of a new Back names the `subagent` call that the Front turn shows.
The Back gets the tools `post_message` and `send_message`. `post_message` posts only into the Front that the origin of the Back names.

### The Back reaches the Front at any time

WHEN the Back, or a subagent of the Back, posts or asks a question
AND no Front turn waits
THEN the plugin opens a Front turn of the bot's own, with message origin `agent`
AND the post or the question lands in that turn.
WHEN the Back runs a turn of its own that no message started
THEN its last words land in a Front turn of the bot's own.
A turn that a person types in the Back stays in the Back.
A bot that names no agent gets a Back on the default agent of the host.

### A restart during a reply

WHEN the daemon starts and a Front log ends with a turn that has no end
THEN the plugin opens the session again when the daemon listens
AND the Front opens that turn again, and the Back gets the message again.

### A bot's connectors

WHEN a bot's record names `connectors`
THEN the plugin keeps the map a session's `connectors` config key holds.
A body that names an alias that is not a lowercase slug, or a value that is not `connectors://<adapter>/<id>`, is refused with -32602.
AND each talk with the bot answers that map through the plugin's `registerBindings` reader.
A Back session that an older daemon started also answers that map.
An edit is what the next tool list and the next call read.
WHEN the bot's record goes
THEN its talks are answered nothing.
A session no bot started is answered nothing too.

### The first turn of each chat is the template

WHEN a new chat opens in a bot's session
THEN the plugin fills the bot's template with `{{name}}`, `{{description}}`, `{{instructions}}` and `{{chats}}`
AND `{{chats}}` lists the last chats, newest first, or "None."
AND the `lastChats` option sets how many chats, with 10 as the default
AND a word not in that list stays as written.

### A template that is gone

WHEN a bot names a template that `<configDir>/templates/` does not hold
THEN the new chat gets the default template
AND the host shows a problem line that names the bot and the template.

### A bot owns one folder

WHEN a make names no workspace
THEN the bot folder is `<root>/<slug>`, with `~/.bots` as the default root
AND a named folder is accepted only under the root
AND a folder that another bot holds is refused with -32602.

### The owner of a new bot

WHEN a make names no owner
THEN the bot's owner is the writer, or `root:<host name>` when there is no writer
AND a team or project owner is accepted only when the writer is a member of it
AND an admin that names a `root:` owner gets `root:<host name>` of this host.

### An edit keeps the owner and the folder

WHEN a write edits a bot that exists
THEN the owner and the workspace stay as they are, and a body that changes them is refused.

### A colour is a name or a hex

WHEN a write names a colour
THEN the plugin accepts one of 11 colour names, or a `#` followed by six hex digits
AND keeps a hex colour in lowercase
AND refuses a short hex such as `#fff`.
A bot made with no colour is red.

### The manifest names this host as an owner

WHEN a client reads the manifest of the `bot` scheme
THEN the owner schema has one choice titled "This host", with the constant value `root:<host name>`
AND the colour schema accepts a colour name or the hex pattern.
This is so that a client can draw an owner picker from the manifest, with no rule of its own.

### Who reads and who writes a bot

WHEN a person reads a bot
THEN the plugin allows it with `bot:get`, as the owner, or as a member of the owner team or project
AND a write is allowed for the owner, a member, a root writer, or a holder of `*:*`.
A `bot:put` grant alone does not let a person edit the bot of somebody else.

### A write that conflicts

WHEN a write names a slug that has a tombstone
THEN the plugin refuses it with -32010
AND a make-only write to a slug that exists is refused with -32010
AND a write whose `ifMatch` differs from the record's `updatedAt` is refused with -32011.

### A bot is removed

WHEN a person removes a bot
THEN the plugin deletes the record and writes a tombstone for its slug
AND the bot folder and its talks stay.

### A hand edit of the file

WHEN a person edits a bot file on disk
THEN the plugin sends the change to the watchers of that bot and to the catalogue
AND a hand edit that changes the owner or the workspace is reported and ignored
AND a hand delete leaves a tombstone, and a malformed file is reported.

### The catalogue of bots

WHEN a client subscribes to `x-ahpd-bots://`
THEN it gets a snapshot of the bots it may read, then `added`, `changed` and `removed` actions
AND each subscriber gets only the bots it may read.
The catalogue computes the lists again when the users of the host change, because a change of membership changes what a person may read.

### A watch on one bot

WHEN a client subscribes to `bot://<slug>`
THEN the host asks for `bot:watch` or a bot the reader may read
AND the plugin sends each change to that bot to the watcher.

## Known gaps

A bot that names a computer profile does not get a machine of its own, and a bot has no agent state of its own.
Removing a bot does not remove a machine.
[A bot runs in a machine](../plans/bots/20261028-0545-a-bot-runs-in-a-machine/plan.md) (draft) gives each bot its own machine and its own agent state.
It also checks a shared machine, and removes the machine of a bot that is removed.
