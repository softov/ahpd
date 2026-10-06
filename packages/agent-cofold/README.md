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
        "store": "/var/lib/ahpd/cofold"
      }
    }
  ]
}
```

With no model named anywhere, the providers, keys and model come from cofold's own configuration file, `$COFOLD_CONFIG` or `$XDG_CONFIG_HOME/cofold/config.json` or `~/.config/cofold/config.json`. Inside a machine the first of those is what finds it.

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

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `provider` | `cofold` | The id a client names in `createSession` |
| `displayName` | `Cofold` | What a person reads instead of the id |
| `description` | | One line about this backend |
| `model` | the cofold file's | The model id a session that names none runs on |
| `baseUrl` | the cofold file's | The OpenAI-compatible endpoint a session that names none uses |
| `instructions` | | The system prompt the agent is created with |
| `computerConfigDir` | the configuration directory the harness reads *inside a machine*. `/ahpd/cofold` by default; `false` leaves the image's own |
| `store` | `$XDG_DATA_HOME/ahpd/cofold` | Where the cofold file store lives |
| `memory` | | `true` to hold the store in memory, for a test |
| `tools` | all four on | Which capabilities a session runs, and where `web_search` gets its providers |
| `apiKey` | the cofold file's | The daemon's own key, or a function asked once per request so an expired one is not cached |
| `resource` | the endpoint's origin when it is `https` | The protected resource a client authenticates against |
| `adapter` | | A cofold `ModelAdapter` used instead of the HTTP one, for an embedder or a test |
| `autoCompactTokens` | 80% of the model's listed context, or of 32000 | The estimated history size at which a session compacts, never above that 80% |
| `policy` | cofold's own default | The run-level policy a pause comes from, which turns the approvals mode control off |

## The tools a session runs

A session gets `@cofold/tools`' four capabilities by default, so it can read, search, edit and write files, run one command, fetch a page and search the web when a provider is configured, and keep memory.
The permission mode is what confines them rather than the workspace, and `default` asks before a write, a command, a web fetch and a read outside the workspace.
A session that names no mode gets `auto`, where a read, inside or outside, and a web fetch run and only a write or a command asks.
An approval offers Allow once, Allow the tool for this session, and Deny; the session choice is sent as `alwaysApprove`, and cofold does not ask about that tool again in the session.

The workspace check resolves symlinks with cofold's own resolver, including a link whose target does not exist yet, so a write through a link that leaves the workspace is outside it.
`web_fetch` refuses loopback, private and link-local addresses on every hop, though not the machine's public address, and a name that answers with a different address at the connection is not caught.

Memory is per workspace and shared by the sessions in it, under `<store>/memory/<workspace slug>/`.
A session opened with no working directory keeps its tools and works in the daemon's current directory.
A shell call is drawn as a terminal with its bare command, and a turn with no model configured fails with a sentence that says to add `"model"` to the cofold configuration file.

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
