# @ahpd/bot

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fbot)](https://www.npmjs.com/package/@ahpd/bot)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 1.0.0](https://img.shields.io/badge/AHP-1.0.0-0b7285)

A bot plugin for the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon. It serves the `bot:` scheme, where a bot is a record with a workspace of its own, talked to in a chat of its own.

Part of [ahpd](https://github.com/softov/ahpd). The source is in [`packages/bot`](https://github.com/softov/ahpd/tree/main/packages/bot).

## Install

```bash
ahpd plugin install @ahpd/bot
ahpd restart
```

Update, remove and one-run flags such as `--plugin` are in [Plugins](https://github.com/softov/ahpd/blob/main/docs/server/PLUGINS.md).

## Options

In the configuration file, with every option set:

```json
{ "plugins": [{ "name": "@ahpd/bot", "options": { "root": "/srv/bots", "lastChats": 20, "mainTurnPostMessageAbsent": "postNotice" } }] }
```

| Option | Default | What it does |
| --- | --- | --- |
| `root` | `~/.bots` | The folder a bot's workspace is under, as `<root>/<slug>` |
| `lastChats` | `10` | How many chats a template lists for `{{chats}}` |
| `mainTurnPostMessageAbsent` | `post` | What a main turn does when the back session's turn ends without `post_message`: `post`, `notice`, `silence` or `postNotice` |

The plugin's own entry needs `session:read` and `session:write`: a message is sent to a back session as a client's chat action, and the session's state is read the same way. The write group also holds `session:trust`, which the trusted start of a back session asks for.

```json
{ "plugins": [{ "name": "@ahpd/bot", "grants": ["session:read", "session:write"], "options": { "root": "/srv/bots" } }] }
```

A bot is a record of the host's record store, so the daemon keeps each one in a folder of its own: `<configDir>/bots/<slug>/bot.md`, the fields as YAML frontmatter, with the tombstones in `<configDir>/bots-gone/`. Beside the record are `chats/` for the main chat rows, `sessions/` for the back session rows and `logs/` for the chat logs. A file there that cannot be read is reported and skipped, and every other bot is kept. A bot's `AGENTS.md` is not there: it is in the bot's work folder, `<root>/<slug>/`.

The record store is a port, so a plugin that takes it over with `registerRecords(store, 'replace')` - a sqlite or a postgresql store - keeps the bots there instead of in files, and nothing in this plugin changes. [`docs/plugins/BOTS.md`](https://github.com/softov/ahpd/blob/main/docs/plugins/BOTS.md#the-record-file) shows one bot file and what a hand edit may change.

No option holds a credential, so the plugin takes nothing from the vault.

## In your own host

The package's `apply` is the plugin entry. Hand it a plugin host from `@ahpd/sdk`, then fold what it registered into the host's options:

```ts
import { createHost, foldHostOptions, listen, pluginHost } from '@ahpd/sdk';
import { claude } from '@ahpd/agent-claude';
import { apply, name } from '@ahpd/bot';

const path = process.cwd();
const context = { path, paths: [path], version: '0.10.0', hostName: 'my-host', configDir: '/var/lib/my-host', log: console.log, say: console.log };
const { host: plugin, contribution, seal } = pluginHost(name, context);
await apply(plugin, { root: '/srv/bots' });
seal();

const { options } = foldHostOptions({ path, agents: [claude({ paths: [path] })] }, [contribution]);
const host = createHost(options);
await listen({ port: 9187 }, (peer) => host.accept(peer));
```

## The `bot:` scheme

A bot is addressed by its slug, which is the URI path and the record's own `id`:

| Command | What it does |
| --- | --- |
| `resourceWrite bot://<slug>` with `createOnly` | Makes a bot. The body is the record, and `name` is the only field it must carry. |
| `resourceWrite bot://<slug>` with `ifMatch` | Edits one. `ifMatch` is the `etag` the last `resourceResolve` answered, so a write against a bot somebody else has changed is refused `-32011`. |
| `resourceRead bot://<slug>` | The record, as JSON, with `chat` where the reader may talk to it. |
| `resourceRead bot://<slug>/<user>` | That person's main chat with the bot, as `{ chat }`. |
| `resourceList bot://<slug>/<user>/` | The names of that person's back sessions. |
| `resourceRead bot://<slug>/<user>/<name>` | One back session, as `{ session }`. |
| `resourceResolve bot://<slug>` | Its metadata, with `etag`. |
| `resourceList bot://` | The bots the reader may see, by slug. |
| `resourceDelete bot://<slug>` | Deletes one, and leaves a tombstone. |
| `createResourceWatch bot://` or `bot://<slug>` | Tells the reader when a bot it may read is made, edited or deleted. |

A slug is lowercase letters, digits and dashes, one to forty of them, starting with a letter. Anything else is refused `-32602`: the slug is a folder name and a URI path at once.

A body may carry `name`, `labels`, `description`, `body`, `color`, `instructions`, `template`, `harness`, `model`, `preset`, `session`, `workspace`, `computer` and `owner`. `id`, `createdAt` and `updatedAt` are read but never obeyed - what they name is the host's, and a write that names another `id` is refused rather than followed. `owner` may be named by a make, as the maker or a team or project the maker belongs to; a write naming anybody else is refused `-32009`, and an edit may not move it. A read answers one key more, `chat`, the reader's own conversation with the bot: it is answered and never obeyed, so a client that writes a record it read back is writing back a bot.

A bot's `session` is the name of the back session a message to it wakes. It is a slug, or a slug holding `{turn}` where the turn id of each message takes that word's place - so a bot that names `{turn}` is a session per message rather than one a person comes back to. A body that names none has `work`, a body that names something that is no name is refused `-32602`, and a file an older daemon wrote without the line is read as the bot that named none.

A bot is drawn in one of fifteen bodies and in one of eleven colours or a hex colour, `#rrggbb`. A make that names neither gets a body at random and the first colour.

### Who may see what

| Who | What they may do |
| --- | --- |
| The owner | Read, edit, delete |
| A member of the owning team or project | Read, edit, delete |
| `bot:get` | Read any bot |
| `bot:list` | List every bot |
| `bot:put` | Make a bot in the scheme, edit their own |
| `bot:chat` | Be answered a chat by any bot they may read |
| `*:*`, or a root connection | Any of it, on any bot |

A listing shows what a read would allow: a list that showed a bot the reader cannot open would be a list of names they cannot use. A read that opens a chat also needs the reader's own `session:create`, because the chat is theirs rather than the bot's.

### The catalogue

A subscribe to `x-ahpd-bots://` answers `{ bots }`, the bots the reader may read, then `x-ahpd-bots/added`, `x-ahpd-bots/changed` and `x-ahpd-bots/removed` as they change - [BOTS.md](https://github.com/softov/ahpd/blob/main/docs/plugins/BOTS.md#the-catalogue).

### The workspace

A bot works in a folder of its own, `<root>/<slug>` unless the body named one, and a named one has to be under `root`. No two bots share a folder, and an edit never moves one: two bots in one tree would be two of them working over each other. The folder is made when the bot is made, so a bot has one whether or not anybody has talked to it yet. A bot in a `computer` is not made a folder here: the machine makes it, as the working directory of whatever runs there.

### The chat and its back sessions

A person talks to a bot in a chat: one session of the `bot-chat` provider per bot and person. The provider runs no model, and a turn it begins stays open until the reply arrives. Each turn is one JSON line under `<configDir>/bots/<slug>/logs/`, so a chat is still readable after the daemon restarts. Nothing about a chat is kept in memory past the process that made it.

The chat is the person's main chat, `bot:/<bot>/<user>`, where `<user>` is the id after `user:` and the machine's name for a reader who is nobody. A message in it wakes a back session, named `bot:/<bot>/<user>/<name>`, which is an ordinary session on the bot's harness, in the bot's folder, owned by the person of the main chat. `bot:/` and `bot://` are the same address.

The name comes from the bot's `session`: `work` unless the bot says otherwise, and a name holding `{turn}` takes the turn id of each message, so that bot starts a new back session per message. A message is a turn in an idle back session and a steer in a working one. The session a name is on is kept with the bot, and a name whose session is gone is started again.

Each message is sent with a `<context>` block in front of the person's words, naming the main chat, the person and the time in the host's offset; the main chat keeps only the person's words. The open main turn shows the back session as a `subagent` tool call that opens its chat.

The back session answers with `post_message`, whose text is added to the main turn; it may post more than once, and the main turn ends when the back session's turn ends. The tool is offered only to a back session and posts only to the main chat that woke the session; it runs without asking for a confirmation. A question asked with the harness's question tool, or an approval, is shown in the main chat, and the answer given there goes back to the back session. A back session that ends its turn without posting leaves the main turn to `mainTurnPostMessageAbsent`: `post` (the default) answers with the turn's last words, `notice` with a notice, `silence` with nothing, and `postNotice` with the last words or the notice where there are none.

A back session's system prompt says only how to answer; the bot's rules are its `AGENTS.md`, made from its template when the bot is made and at the first wake where the folder has none.

A chat is opened by a read. `resourceRead bot://<slug>` answers the record with `chat`, the URI of the reader's own conversation with that bot, and the first read by a reader who may chat starts it and keeps the row. Reading the same bot again answers the same chat, and two people reading one bot are answered two different chats. A reader who may not chat is answered the record alone, with no `chat` and no refusal. A read of `bot://<slug>/<user>` answers `{ chat }` and a read of `bot://<slug>/<user>/<name>` answers `{ session }`; both are answered to the person named, the bot's owner and this host.

A chat works in the bot's `workspace` and is titled with the bot's `name`. Starting one asks the reader's own `session:create`, by the host's own road, and a refusal there is the read's refusal.

A bot may name a `template`, the text a chat with it would open with and the text its `AGENTS.md` is made from, and a bot that names none gets the default one the plugin ships. A make or an edit that names a template that does not exist is refused `-32602`. Nothing fills a chat template yet: a chat runs no model, so there is no first turn for one to open.

### The tombstone

A deleted slug is not made again. A client held the address, and a different bot answering to it would be a lie about what that client has. A make on a deleted slug is refused `-32010`.

## Documentation

| | |
| --- | --- |
| [BOTS.md](https://github.com/softov/ahpd/blob/main/docs/plugins/BOTS.md) | The `bot:` scheme, the record and the chat |
| [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/plugins/PLUGINS.md) | Writing and loading a plugin |
| [GET-STARTED.md](https://github.com/softov/ahpd/blob/main/docs/server/GET-STARTED.md) | Running the daemon |

## License

MIT © Softov
