# @ahpd/bot

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fbot)](https://www.npmjs.com/package/@ahpd/bot)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

A bot plugin for the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon. It serves the `bot:` scheme, where a bot is a record with a workspace of its own and a session to run in.

Part of [ahpd](https://github.com/softov/ahpd). The source is in [`packages/bot`](https://github.com/softov/ahpd/tree/main/packages/bot).

## Install

```bash
ahpd plugin install @ahpd/bot
```

That installs it where the daemon looks for plugins and adds it to `plugins` in the configuration file. A plugin installed with `npm i -g` is not seen.

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

A body may carry `name`, `labels`, `description`, `body`, `color`, `instructions`, `harness`, `model`, `preset`, `workspace` and `computer`. `id`, `owner`, `createdAt` and `updatedAt` are read but never obeyed - what they name is the host's, and a write that names another `id` or another owner is refused rather than followed.

A bot is drawn in one of fifteen bodies and one of eleven colours. A make that names neither gets a body at random and the first colour.

### Who may see what

| Who | What they may do |
| --- | --- |
| The owner | Read, edit, delete |
| A member of the owning team or project | Read |
| `bot:get` | Read any bot |
| `bot:list` | List every bot |
| `bot:put` | Make a bot in the scheme, edit their own |

A listing shows what a read would allow: a list that showed a bot the reader cannot open would be a list of names they cannot use.

### The workspace

A bot works in a folder of its own, `<root>/<slug>` unless the body named one. No two bots share a folder, and an edit never moves one: two bots in one tree would be two sessions working over each other.

### The tombstone

A deleted slug is not made again. A client held the address, and a different bot answering to it would be a lie about what that client has. A make on a deleted slug is refused `-32010`.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `root` | `~/.bots` | The folder a bot's workspace is under, as `<root>/<slug>` |

```json
{ "plugins": [{ "name": "@ahpd/bot", "options": { "root": "/srv/bots" } }] }
```

The records themselves are kept beside the daemon's own configuration, in `<configDir>/bots/`, and the tombstones in `<configDir>/bots-gone/`. A file there that cannot be read is reported at startup and skipped, and every other bot is kept.

## Documentation

| | |
| --- | --- |
| [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/PLUGINS.md) | Writing and loading a plugin |
| [DAEMON.md](https://github.com/softov/ahpd/blob/main/docs/DAEMON.md) | Running the daemon |

## License

MIT © Softov
