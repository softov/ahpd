# @ahpd/agent-cofold

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fagent-cofold)](https://www.npmjs.com/package/@ahpd/agent-cofold)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

The cofold agent runtime as a backend for [`@ahpd/sdk`](https://www.npmjs.com/package/@ahpd/sdk), and a plugin for the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon. It registers the engine `cofold`: each record of that engine is one agent, and every model an OpenAI-compatible endpoint serves is a model inside it.

A session uses the models and keys cofold already knows about, and runs cofold's file, shell, web and memory tools in the daemon's process.

Part of [ahpd](https://github.com/softov/ahpd). The source is in [`packages/agent-cofold`](https://github.com/softov/ahpd/tree/main/packages/agent-cofold).

## Install

```bash
ahpd plugin install @ahpd/agent-cofold
ahpd restart
```

Update, remove and one-run flags such as `--plugin` are in [Plugins](https://github.com/softov/ahpd/blob/main/docs/server/PLUGINS.md).

## Options

In the configuration file, with the plugin's own options as the defaults every record of the engine starts from:

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

`COFOLD_BASE_URL`, `COFOLD_API_KEY` and `COFOLD_MODEL` are read on top of that file, as cofold's own CLI reads them: the URL adds or replaces a provider called `default` with the key as its key, and a model with no slash is a model of `default`. A model id with a slash of its own, as OpenRouter's are, is written after `default/`, because the first slash ends the provider: `default/deepseek/deepseek-chat`. A machine profile names them as the needs `cofoldBaseUrl`, `cofoldApiKey` and `cofoldModel`, the key from the vault, so a machine on another box gets a provider with no file holding the key.

Every provider in the cofold file is asked for its models, each with its own key. Each id is offered as `<provider id>/<model id>`, such as `open_router/moonshotai/kimi-k3.1-pro`. The backend's own id is the prefix only for an explicit `baseUrl` or for the local endpoint when the file names no provider.

Every option below is a key under `options` in the plugin's entry, and the daemon checks each value against the schema before `apply` runs. An agent of the engine is a record on the agents channel: it sets any of these except `strictTools` and the keyed search providers, and wins over the plugin for the ones it sets. A record's id, name and description are the record's own, so this plugin has no option for them. There are two more options, `adapter` and `policy`, that only an embedder calling `apply` in code passes: a model adapter is an object of methods and a policy is a function, so neither is in the options schema and a configuration file cannot name them.

| Option | Default | What it does |
| --- | --- | --- |
| `model` | the cofold file's | The model id a record that names none runs on |
| `baseUrl` | the cofold file's | The OpenAI-compatible endpoint a record that names none uses |
| `instructions` | the cofold file's, else `You are a helpful assistant.` | The system prompt a record that names none is created with |
| `computerConfigDir` | `/ahpd/cofold` | The configuration directory the harness reads *inside a machine*: a state volume seeded with its `config.json`, or that file mounted read-only in a profile with `state: "host"`. `false` leaves the image's own |
| `store` | `$XDG_DATA_HOME/ahpd/cofold` | The folder each record's cofold file store lives under, one folder per record, so two agents do not list each other's sessions |
| `memory` | `false` | `true` to hold each record's store in memory, for a test |
| `tools` | all four on | Which capabilities a session runs, and where `web_search` gets its providers |
| `strictTools` | `true` | `false` holds `tools` to the loose check, so a key cofold does not know is dropped rather than refused |
| `apiKey` | the cofold file's | The daemon's own key, for a record that names none. `{ "$secret": "host:<name>" }` reads it from the vault; an embedder may pass a function asked once per request |
| `resource` | the endpoint's origin when it is `https` | The protected resource a client authenticates against |
| `autoCompactTokens` | 80% of the model's listed context, or of 32000 | The estimated history size at which a session compacts, never above that 80% |

`ahpd vault set host:<name>` keeps a key that `apiKey` or a search provider's `apiKey` reads with `{ "$secret": "host:<name>" }`, from standard input. See [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/plugins/PLUGINS.md#naming-a-secret-instead-of-holding-one) for a `$secret`.

### `tools`

An absent key is on, and `false` turns that capability off.

| Option | Default | What it does |
| --- | --- | --- |
| `files` | `true` | `read_file`, `write_file` and `edit_file`, titled by the file; `list_files` and `search_files`, titled by the pattern |
| `shell` | `true` | `shell_exec`, titled by its command, one command at a time through the platform's shell |
| `memory` | `true` | `memory_read` and `memory_write`, titled by the memory file, under `<store>/memory/<workspace slug>/` |
| `web` | `true` | `web_fetch`, titled by the URL; an object adds `web_search`, titled by the query, over the providers in its `search` |

### `tools.web.search`

The providers `web_search` asks, in the order they are written. A failing one is skipped. A record may name `duckduckgo` alone: the channel vaults a record's top-level key fields only, so a key nested here would be kept in the record rather than in the vault.

| Option | Default | What it does |
| --- | --- | --- |
| `brave` | none | Brave Search, as `{ "apiKey": "..." }` |
| `tavily` | none | Tavily, as `{ "apiKey": "..." }` |
| `duckduckgo` | `false` | `true` scrapes DuckDuckGo's results page, with no key |

## A record of the engine

An agent is a record on `x-ahpd-agents`: `{ id, engine, owner, name, description?, icon?, model?, config }`. The channel owns `name`, `description`, `icon` and `model`, so `config` holds the cofold fields above, and a new record starts from the engine's one template, which sets nothing and runs on cofold's own configuration file.

`computerConfigDir`, `store` and `memory` are host-only: a team's or a person's record that sets one is refused. `strictTools` is not a field of a record at all, and neither is a keyed search provider, for the reason the `tools.web.search` table gives; `adapter` and `policy` are not options of the schema at all, only values an embedder passes in code. The engine names no key variable: the daemon's own `COFOLD_API_KEY` is the harness's, read with its file, and a record's `apiKey` is a `secret` field of its own, so the channel keeps it in the vault under `host:agent/<id>/apiKey` for a host record, and no client, session or log gets the value.

A record that names its own endpoint and key, with the model the channel owns:

```json
{
  "id": "cofold-deepseek",
  "engine": "cofold",
  "owner": "host",
  "name": "Cofold on DeepSeek",
  "model": "deepseek-chat",
  "config": {
    "baseUrl": "https://api.deepseek.com/v1",
    "apiKey": { "$secret": "host:deepseek" }
  }
}
```

A client puts the key's value, and the channel moves it to the vault under `host:agent/<id>/apiKey` and keeps a `{ "$secret": "<name>" }` in its place, so no client is shown the value again. The record above names `host:deepseek`, the form a record written by hand on disk uses; `ahpd vault set host:deepseek` keeps that entry from standard input.

A client makes one with `x-ahpd/agents/put`, and the daemon keeps it at `agents/<id>.json` in its configuration folder. A record whose `config` no longer fits, or whose `$secret` the vault cannot answer, is written and shown as `invalid` with one line naming it, and no value; a record whose engine no plugin registers any more is kept and shown as `unavailable`.

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

## In a machine

A session in a machine runs nested: an `ahpd` from the `ahpd` part, which carries this plugin, is started inside, so any glibc image runs it with nothing installed. Its configuration is a state volume at `/ahpd/cofold`, seeded with this host's file, and the keys in that file are readable by anything in the machine. See [Cofold in a machine](https://github.com/softov/ahpd/blob/main/docs/plugins/COMPUTERS.md#cofold-in-a-machine).

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

## A turn that fails

A turn that fails on a model call can be resumed from the client, and the same prompt runs again under the turn's own id. cofold cuts the store through the last message of the turn before, so the failed prompt and what the run wrote after it leave the store. The conversation holds the prompt once, not once for each attempt. A conversation whose first turn failed has its session dropped, and the run makes it again on the same workspace. The calls the failed turn ran are run again, because the cut drops them with the prompt.

A turn that never ran carries no resume. This is a session with no model configured, or a cut the store refused. A turn read back after a restart carries none either, because this process did not watch it run and has no point to cut to.

## Documentation

| | |
| --- | --- |
| [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/plugins/PLUGINS.md) | The whole backend, the session settings and the cofold configuration |
| [AGENT.md](https://github.com/softov/ahpd/blob/main/docs/sdk/AGENT.md) | The `Agent` and `Session` contracts this implements |
| [cofold](https://github.com/softov/cofold) | The agent runtime this runs |

## License

MIT © Softov
