# @ahpd/bot

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fbot)](https://www.npmjs.com/package/@ahpd/bot)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

A bot plugin for the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon. It serves the `bot:` scheme, where a bot is a record with a workspace of its own and a session to run in.

Part of [ahpd](https://github.com/softov/ahpd). The source is in [`packages/bot`](https://github.com/softov/ahpd/tree/main/packages/bot).

## In the daemon

```bash
ahpd plugin install @ahpd/bot
```

That installs it where the daemon looks for plugins and adds it to `plugins` in the configuration file. A plugin installed with `npm i -g` is not seen.

In the configuration file, with every option set:

```json
{ "plugins": [{ "name": "@ahpd/bot", "options": { "root": "/srv/bots" } }] }
```

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `root` | `~/.bots` | The folder a bot's workspace is under, as `<root>/<slug>` |

The records themselves are kept beside the daemon's own configuration, in `<configDir>/bots/`, and the tombstones in `<configDir>/bots-gone/`. A file there that cannot be read is reported at startup and skipped, and every other bot is kept.

## Commands

| Command | What it does |
| --- | --- |
| `ahpd plugin install @ahpd/bot` | Install the package into the configuration directory and name it in `config.json` |
| `ahpd plugin update @ahpd/bot` | Move it to the version that matches the daemon; `all` in place of the name moves every installed plugin |
| `ahpd plugin list` | What the configuration names, and what a run would load, without loading it |

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
| `resourceRead bot://<slug>` | The record, as JSON. |
| `resourceResolve bot://<slug>` | Its metadata, with `etag`. |
| `resourceList bot://` | The bots the reader may see, by slug. |
| `resourceDelete bot://<slug>` | Deletes one, and leaves a tombstone. |

A slug is lowercase letters, digits and dashes, one to forty of them, starting with a letter. Anything else is refused `-32602`: the slug is a folder name and a URI path at once.

A body may carry `name`, `labels`, `description`, `body`, `color`, `instructions`, `harness`, `model`, `preset`, `workspace`, `computer` and `session`. `id`, `createdAt` and `updatedAt` are read but never obeyed - what they name is the host's, and a write that names another `id` is refused rather than followed. `owner` may be named by a make, as the maker or a team or project the maker belongs to; a write naming anybody else is refused `-32009`, and an edit may not move it.

A bot is drawn in one of fifteen bodies and one of eleven colours. A make that names neither gets a body at random and the first colour.

### Who may see what

| Who | What they may do |
| --- | --- |
| The owner | Read, edit, delete |
| A member of the owning team or project | Read, edit, delete |
| `bot:get` | Read any bot |
| `bot:list` | List every bot |
| `bot:put` | Make a bot in the scheme, edit their own |
| `*:*`, or a root connection | Any of it, on any bot |

A listing shows what a read would allow: a list that showed a bot the reader cannot open would be a list of names they cannot use. Making a bot also needs the maker's `session:create` where a session is started for it, because that session is theirs.

### The workspace

A bot works in a folder of its own, `<root>/<slug>` unless the body named one, and a named one has to be under `root`. No two bots share a folder, and an edit never moves one: two bots in one tree would be two sessions working over each other. The folder is made when the bot is made, before its session starts, since that is where the session works.

### The session

A bot is talked to in its session. A body may link one its owner already has by naming it in `session`, and the link is kept only where the host has that session and it belongs to the bot's owner: a URI this host has no session for is refused `-32602`, and one that belongs to somebody else is refused `-32009`.

A bot made with no `session` is given one. The host starts it as the bot's owner, which is the same session that person could have made themselves: the owner's own `session:create` is asked first, and a refusal reads exactly as it does at the door. It runs the bot's `preset`, or its `harness` and `model`, in the bot's workspace, or in the `computer` the record names; its first turn is the bot's `instructions`, and its title is the bot's `name`. A bot with no instructions asks for a session that opens with nobody speaking. The host is asked before the record is saved, so a start the owner may not make leaves no bot behind.

An edit that sets `session` to `null` unlinks it, and an edit that says nothing about `session` leaves the link as it was.

### The tombstone

A deleted slug is not made again. A client held the address, and a different bot answering to it would be a lie about what that client has. A make on a deleted slug is refused `-32010`.

## Documentation

| | |
| --- | --- |
| [BOTS.md](https://github.com/softov/ahpd/blob/main/docs/BOTS.md) | The `bot:` scheme, the record and the session |
| [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/PLUGINS.md) | Writing and loading a plugin |
| [DAEMON.md](https://github.com/softov/ahpd/blob/main/docs/DAEMON.md) | Running the daemon |

## License

MIT © Softov
