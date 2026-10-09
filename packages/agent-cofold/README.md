# @ahpd/agent-cofold

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fagent-cofold)](https://www.npmjs.com/package/@ahpd/agent-cofold)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

The cofold agent runtime as a backend for [`@ahpd/sdk`](https://www.npmjs.com/package/@ahpd/sdk), and a plugin for the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon. It registers the provider `cofold`, and every model an OpenAI-compatible endpoint serves is a model inside it.

A session uses the models and keys cofold already knows about, and runs cofold's file, shell, web and memory tools in the daemon's process.

Part of [ahpd](https://github.com/softov/ahpd). The source is in [`packages/agent-cofold`](https://github.com/softov/ahpd/tree/main/packages/agent-cofold).

## In the daemon

```bash
ahpd plugin install @ahpd/agent-cofold
ahpd --plugin @ahpd/agent-cofold --path /work/project
```

Or in the configuration file, with the backend's own options as defaults for every session it serves:

```json
{
  "plugins": [
    {
      "name": "@ahpd/agent-cofold",
      "options": {
        "model": "deepseek-chat",
        "baseUrl": "https://api.deepseek.com/v1",
        "apiKey": { "$secret": "host:deepseek" },
        "store": "/var/lib/ahpd/cofold",
        "tools": { "web": { "search": { "duckduckgo": true } } }
      }
    }
  ]
}
```

With no model named anywhere, the providers, keys and model come from cofold's own configuration file, `$COFOLD_CONFIG` or `$XDG_CONFIG_HOME/cofold/config.json` or `~/.config/cofold/config.json`. Inside a machine the first of those is what finds it.

A session in a machine runs nested: an `ahpd` from the `ahpd` part, which carries this plugin, is started inside, so any glibc image runs it with nothing installed. Its configuration is a state volume at `/ahpd/cofold`, seeded with this host's file, and the keys in that file are readable by anything in the machine. See [Cofold in a machine](https://github.com/softov/ahpd/blob/main/docs/COMPUTER.md#cofold-in-a-machine).

## Options

Every option below is a key under `options` in the plugin's entry, and the daemon checks each value against the schema before `apply` runs.

| Option | Default | What it does |
| --- | --- | --- |
| `provider` | `cofold` | The id a client names in `createSession` |
| `displayName` | `Cofold` | What a person reads instead of the id |
| `description` | none | One line about this backend |
| `model` | the cofold file's | The model id a session that names none runs on |
| `baseUrl` | the cofold file's | The OpenAI-compatible endpoint a session that names none uses |
| `instructions` | the cofold file's, else `You are a helpful assistant.` | The system prompt the agent is created with |
| `computerConfigDir` | `/ahpd/cofold` | The configuration directory the harness reads *inside a machine*: a state volume seeded with its `config.json`, or that file mounted read-only in a profile with `state: "host"`. `false` leaves the image's own |
| `store` | `$XDG_DATA_HOME/ahpd/cofold` | Where the cofold file store lives |
| `memory` | `false` | `true` to hold the store in memory, for a test |
| `tools` | all four on | Which capabilities a session runs, and where `web_search` gets its providers |
| `strictTools` | `true` | `false` holds `tools` to the loose check, so a key cofold does not know is dropped rather than refused |
| `apiKey` | the cofold file's | The daemon's own key. `{ "$secret": "host:<name>" }` reads it from the vault; an embedder may pass a function asked once per request |
| `resource` | the endpoint's origin when it is `https` | The protected resource a client authenticates against |
| `adapter` | the HTTP one | A cofold `ModelAdapter` used instead of the HTTP one, for an embedder or a test |
| `autoCompactTokens` | 80% of the model's listed context, or of 32000 | The estimated history size at which a session compacts, never above that 80% |
| `policy` | cofold's own default | The run-level policy a pause comes from, which turns the approvals mode control off |

### `tools`

An absent key is on, and `false` turns that capability off.

| Option | Default | What it does |
| --- | --- | --- |
| `files` | `true` | `read_file`, `write_file` and `edit_file`, titled by the file; `list_files` and `search_files`, titled by the pattern |
| `shell` | `true` | `shell_exec`, titled by its command, one command at a time through the platform's shell |
| `memory` | `true` | `memory_read` and `memory_write`, titled by the memory file, under `<store>/memory/<workspace slug>/` |
| `web` | `true` | `web_fetch`, titled by the URL; an object adds `web_search`, titled by the query, over the providers in its `search` |

### `tools.web.search`

The providers `web_search` asks, in the order they are written. A failing one is skipped.

| Option | Default | What it does |
| --- | --- | --- |
| `brave` | none | Brave Search, as `{ "apiKey": "..." }` |
| `tavily` | none | Tavily, as `{ "apiKey": "..." }` |
| `duckduckgo` | `false` | `true` scrapes DuckDuckGo's results page, with no key |

## Commands

| Command | What it does |
| --- | --- |
| `ahpd plugin install @ahpd/agent-cofold` | Install the package into the configuration directory and name it in `config.json` |
| `ahpd plugin update @ahpd/agent-cofold` | Move it to the version that matches the daemon; `all` in place of the name moves every installed plugin |
| `ahpd plugin list` | What the configuration names, and what a run would load, without loading it |
| `ahpd vault set host:<name>` | Keep a key that `apiKey` or a search provider's `apiKey` reads with `{ "$secret": "host:<name>" }`, from standard input |

See [DAEMON.md](https://github.com/softov/ahpd/blob/main/docs/DAEMON.md#--plugin-and-what-naming-one-runs) for what naming a plugin runs, and [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/PLUGINS.md#naming-a-secret-instead-of-holding-one) for a `$secret`.

## In your own host

```bash
pnpm add @ahpd/agent-cofold @ahpd/sdk
```

```ts
import { createHost, listen } from '@ahpd/sdk';
import { cofoldAgent } from '@ahpd/agent-cofold';

const host = createHost({
  path: process.cwd(),
  agents: [cofoldAgent({ model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' })],
});
await listen({ port: 9187 }, (peer) => host.accept(peer));
```

## The tools a session runs

A session gets `@cofold/tools`' four capabilities by default, so it can read, search, edit and write files, run one command, fetch a page and search the web when a provider is configured, and keep memory. The permission mode is what confines them rather than the workspace, and `default` asks before a write, a command, a web fetch and a read outside the workspace. A session that names no mode gets `auto`, where a read, inside or outside, and a web fetch run and only a write or a command asks. An approval offers Allow once, Allow the tool for this session, and Deny; the session choice is sent as `alwaysApprove`, and cofold does not ask about that tool again in the session.

The workspace check resolves symlinks with cofold's own resolver, including a link whose target does not exist yet, so a write through a link that leaves the workspace is outside it. `web_fetch` refuses loopback, private and link-local addresses on every hop, though not the machine's public address, and a name that answers with a different address at the connection is not caught.

A write or an edit needs the file to have been read in this session, and cofold refuses one it has not seen. A file that changed since it was read is refused too. What a session read is held in the process, so a restart means reading it again. `"files": { "requireRead": false }` turns the rule off for the session, and the rule stays on when the key is absent.

Memory is per workspace and shared by the sessions in it, under `<store>/memory/<workspace slug>/`. A session opened with no working directory keeps its tools and works in the daemon's current directory. A shell call is drawn as a terminal with its bare command, and a turn with no model configured fails with a sentence that says to add `"model"` to the cofold configuration file.

`tools` turns one off by naming it `false`, and gives `web_search` its providers:

```json
{ "tools": { "shell": false, "web": { "search": { "duckduckgo": true } } } }
```

The named providers are tried in the order the configuration lists them, and a failing one is skipped.

## Documentation

| | |
| --- | --- |
| [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/PLUGINS.md) | The whole backend, the session settings and the cofold configuration |
| [AGENT.md](https://github.com/softov/ahpd/blob/main/docs/AGENT.md) | The `Agent` and `Session` contracts this implements |
| [cofold](https://github.com/softov/cofold) | The agent runtime this runs |

## License

MIT © Softov
