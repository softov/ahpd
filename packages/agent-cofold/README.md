# @ahpd/agent-cofold

The cofold agent runtime as a backend for [`ahpd`](https://github.com/softov/ahpd), registered under the provider `cofold`, so every model an OpenAI-compatible endpoint serves is a model inside one provider rather than a package of its own.

A session can reach the models and keys cofold already knows about, and it runs cofold's own files, shell, web and memory tools in the daemon's process, the way a Claude session runs its tools in the Claude CLI.

## Use

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

With no model named anywhere, the cofold configuration file at `$XDG_CONFIG_HOME/cofold/config.json` or `~/.config/cofold/config.json` is read for the providers, the keys and the model, so a person who has already pointed cofold at a provider does not say it again here.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `provider` | `cofold` | The id a client names in `createSession` |
| `displayName` | `Cofold` | What a person reads instead of the id |
| `description` | | One line about this backend |
| `model` | the cofold file's | The model id a session that names none runs on |
| `baseUrl` | the cofold file's | The OpenAI-compatible endpoint a session that names none uses |
| `instructions` | | The system prompt the agent is created with |
| `store` | `$XDG_DATA_HOME/ahpd/cofold` | Where the cofold file store lives |
| `memory` | | `true` to hold the store in memory, for a test |
| `tools` | all four on | Which capabilities a session runs, and where `web_search` gets its providers |
| `apiKey` | the cofold file's | The daemon's own key, or a function asked once per request so an expired one is not cached |
| `resource` | the endpoint's origin when it is `https` | The protected resource a client authenticates against |
| `adapter` | | A cofold `ModelAdapter` used instead of the HTTP one, for an embedder or a test |
| `policy` | cofold's own default | The run-level policy a pause comes from, which turns the approvals mode control off |

## The tools a session runs

A session gets `@cofold/tools`' four capabilities by default, so it can read, search, edit and write files, run one command, fetch a page and search the web when a provider is configured, and keep memory.
The permission mode is what confines them rather than the workspace, and `default` asks before a write, a command, a web fetch and a read outside the workspace.
A session that names no mode gets `auto`, where a read, inside or outside, and a web fetch run and only a write or a command asks.

The workspace check resolves symlinks with cofold's own resolver, including a link whose target does not exist yet, except a dangling link whose target reads `dir/../name` with `dir` a symlink out of the workspace, which can still pass as inside.
`web_fetch` refuses loopback, private and link-local addresses on every hop, though not the machine's public address, and a name that answers with a different address at the connection is not caught.

Memory is per workspace and shared by the sessions in it, under `<store>/memory/<workspace slug>/`.
A session opened with no working directory keeps its tools and works in the daemon's current directory.
A shell call is drawn as a terminal with its bare command, and a turn with no model configured fails with a sentence that says to add `"model"` to the cofold configuration file.

`tools` turns one off by naming it `false`, and gives `web_search` its providers:

```json
{ "tools": { "shell": false, "web": { "search": { "duckduckgo": true } } } }
```

The named providers are tried in the order the configuration lists them, and a failing one is skipped.

See [`docs/PLUGINS.md`](../../docs/PLUGINS.md) for the whole backend, the session settings and the harness configuration.

## License

MIT
