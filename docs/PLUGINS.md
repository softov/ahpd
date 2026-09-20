# Writing a plugin

A plugin is an installed package the daemon folds into the options it hands
`createHost`, so a backend, a port, a server tool or a configuration default is
an install and a configuration line rather than a fork of ahpd.

This is the author's guide: the contract, what you may register, the manifest,
how a plugin is named, and what happens when one fails. The rules behind it are
in [`.project/decisions/plugin-*`](../.project/decisions/) and the loader itself
is [packages/server/src/plugins.ts](../packages/server/src/plugins.ts).

## The contract

A plugin is a module with named exports, in the same idiom as an `Agent`:

```ts
export const name = '@acme/agent-mine';       // required by convention, the identity
export const title = 'Mine';                  // optional, what a listing prints
export const defaults = { model: 'fast' };    // optional, under the configuration's values
export function apply(host: PluginHost, options: Record<string, unknown>): void | Promise<void>;
```

Only `apply` is required, and it will be given a `PluginHost` and the options
the configuration named. There is deliberately **no default export**: a module
that exports only `default` is refused with `<url> does not export an apply
function`, because which export is the plugin cannot be guessed at.

`apply` may be async. It runs once, before the host exists, in the daemon's own
process.

## What you can register

The surface is `HostOptions` named back, so there is nothing new to learn. Every
method that contributes a value is named `register*`, and every value is checked
against its contract before it is recorded.

| Method | Operation | What it becomes |
| --- | --- | --- |
| `registerAgent(agent)` | append | A backend a client names in `createSession` |
| `registerTool(tool)` | append | A server tool offered to every session's model |
| `registerResources(store)` | set | `list`, `read`, `resolve`, `complete`, and the optional write half |
| `registerTerminals(store)` | set | `create` |
| `registerChanges(source)` | set | `scopes`, `state`, `summary`, and the optional operations |
| `registerDirectories(facts)` | set | `meta`, and the optional `refresh` |
| `registerWorktrees(worktrees)` | set | `repository`, `branches`, `create`, `dirty`, `remove` |
| `registerGithub(pullRequests)` | set | `resource`, `forBranch`, `create` |
| `registerAutomations(store)` | set | the automation store |
| `registerSessions(store)` | set | the session store: flags, config, artifacts, pull requests, chat titles |
| `registerDiagnostics(diagnostics)` | set | all members optional, so `{}` is valid |

The nine ports are **singletons**. A plugin that supplies one the daemon already
has must say so:

```ts
host.registerResources(myStore, 'replace');
```

Without `'replace'` the value does not move and the conflict is reported. The
nine names are the closed set: `agents` and `tools` are appended and cannot be
reached as ports, so no key has two spellings.

A plugin that registers the same port twice, or two agents with one `provider`,
fails its own `apply` rather than the daemon.

### What a tool says about itself

A `HostTool` may carry `effects`: `reads`, `writes`, `network` and
`destructive`, each optional and nothing set when the tool does not say.

```ts
host.registerTool({
  definition: { name: 'remove_file', description: 'Deletes a file.', inputSchema: { type: 'object', properties: {} } },
  effects: { writes: true, destructive: true },
  run: async (input, at) => { … },
});
```

It is the host's own claim, not a guarantee, and it is what a backend reads to
decide whether to ask a person. `@ahpd/agent-facio` passes it to the runtime,
whose default policy asks about a destructive tool, so a daemon configured only
from a file can have one gated with no policy of its own. A tool that says
nothing behaves exactly as it did before the field existed.

### Read-only context

`PluginHost` also carries what `apply` may read and not change:

| | |
| --- | --- |
| `path` | The first directory the host serves |
| `paths` | Every directory the host serves |
| `version` | The `@ahpd/sdk` version actually in use |
| `log(line)` | One line to the daemon's log |

### What is not a kind

So you do not go looking for a method that should not exist:

- **Models** are not registered. Each agent reports its own through `probe()`.
- **Slash commands** are not separate from customizations, and `Offered.commands`
  is already one projection of them.
- **UI** is not, because a client owns its screen and the host serves it
  resources.
- **HTTP routes** are not, because there is no HTTP server.

Customizations, MCP servers, a configuration key and host methods are named in
the domain reference and not built yet; the whole list is in
[deferred.md](../.project/plans/plugin/01-plugins-load-from-configuration/deferred.md).

## Events

A plugin may watch the host do its work with `on`. It is the one method not
named `register*`, because it contributes nothing to `HostOptions`: it attaches
a listener to a moment the host already has.

```ts
export function apply(host: PluginHost) {
  host.on('session_start', (event, ctx) => {
    ctx.log(`session ${event.session} on ${event.provider}`);
  });
  host.on('turn_end', async (event) => {
    await report(event.session, event.turn, event.status);
  });
}
```

The handler is called with the event and the same read-only `PluginContext`
`apply` was handed. Its return value is ignored and it cannot refuse or rewrite
what it observes; a plugin that wants to change what happens contributes a tool,
a port or an agent instead. Handlers run in registration order, each is awaited
before the next, and a handler that throws is reported against its plugin and
does not stop the next handler or the action it observed.

| Event | What else the payload carries |
| --- | --- |
| `session_start` | `session`, `provider` |
| `session_end` | `session`, `reason` |
| `turn_start` | `session`, `chat`, `turn` |
| `turn_end` | `session`, `chat`, `turn`, `status` (`complete` or `cancelled`) |
| `message` | `session`, `chat`, `turn`, `text` |
| `tool_call` | `session`, `chat`, `tool`, `ok`, and `error` when it threw |
| `client_connect` | `client` |
| `client_disconnect` | `client` |
| `authenticated` | `client`, `resource` |
| `automation_fire` | `automation`, `run` |
| `resource_write` | `uri` |
| `terminal_open` | `terminal`, `cwd` |
| `log` | `line`, the same string `onEvent` receives |

There is no per-token event: a plugin that wants the live stream of a turn is a
client. The `chat` on a turn event is the host's own chat URI, which is not
always the alias a client addressed it by.

## The manifest

A plugin that is a package declares its metadata in `package.json` and nowhere
else. There is no `manifest.json`.

```json
{
  "name": "@acme/agent-mine",
  "version": "1.0.0",
  "type": "module",
  "exports": { ".": "./dist/index.js" },
  "peerDependencies": { "@ahpd/sdk": "^0.6" },
  "ahpd": { "entry": "./dist/index.js", "title": "Mine" }
}
```

| Key | |
| --- | --- |
| `ahpd.entry` | What to import, when `exports` is not enough to say. It wins over `exports`, `main` and `index.js` for resolution, and a mismatch with what the package resolves to is reported |
| `ahpd.title` | What `ahpd plugin list` prints, unless the module exports its own `title` |
| `ahpd.options` | A required option the configuration must set before the plugin is `ready`. `true` or `{ "required": true }` means required. Today this is only reported by `ahpd plugin list`; it does not yet stop `apply` |
| `peerDependencies["@ahpd/sdk"]` | The compatibility range, checked **before** the module is imported |

Compatibility supports `*`, an exact version, `^`, `~`, `>=`, `<=`, `>`, `<`,
`=`, and a space-separated conjunction such as `>=0.6 <0.7`. Anything it cannot
read is refused by name rather than passed, so a misspelled range fails loudly
instead of loading unchecked. A package with no `peerDependencies` loads, because
absent is not incompatible.

The module is still the contract: `entry` says what to import, `apply` says what
it is.

## Naming a plugin

```bash
ahpd --plugin @acme/agent-mine              # an installed package
ahpd --plugin ./my-plugin                   # a directory with a manifest
ahpd --plugin ./scratch-plugin.mjs          # a single file
ahpd --plugin @acme/agent-mine --plugin ./another
ahpd --no-plugins                           # load none, whatever the file says
```

Or in the configuration file:

```json
{
  "plugins": [
    "@acme/agent-mine",
    { "name": "./my-plugin", "options": { "token": "…" }, "enabled": false }
  ]
}
```

`--plugin` is repeatable and plugins apply in the order named. A command line
`--plugin` **replaces** the file's `plugins` list rather than adding to it, the
way `--path` replaces `paths`. `--no-plugins` beside a `--plugin` is refused as
contradictory. The options an object names are merged over the plugin's own
`defaults`, so the configuration wins.

### Where a spec is resolved

| Spec | Resolved |
| --- | --- |
| A bare name, `@acme/agent-mine` | Through `createRequire` against the configuration directory, so `npm i` in `~/.config/ahpd` is the install |
| A relative or absolute path | The working directory first, then the configuration directory; the absolute path that ran is logged |
| A directory | Through its manifest, in the order `ahpd.entry`, `exports["."]`, `main`, `index.js` |
| A scheme, `file:`, `npm:`, `jsr:`, `https:`, `data:` | Passed through untouched, because what an import of one means is the runtime's business |
| A bare name on Deno | Refused with a message saying to write `npm:<name>`, because Deno has no `createRequire` |

The configuration directory is `$XDG_CONFIG_HOME/ahpd` or `~/.config/ahpd`.

## What happens when a plugin fails

A plugin is code in the daemon's process with the daemon's permissions, so
naming one is the trust decision. The configuration file is the trust boundary
here the way the connection token is the port's.

- A plugin that does not resolve, whose manifest is wrong, that throws on
  import, that has no `apply`, or that throws out of `apply` is **reported on
  stdout and skipped**. The daemon starts without it and the next plugin is
  still tried. A bad registration loses that plugin's whole contribution rather
  than the part it registered before the mistake.
- Two plugins claiming the same agent `provider` is the one failure that
  **refuses the start**. A host built over a collision would answer a turn with
  the wrong backend, and the message names both plugins.

`ahpd plugin list` says what the configuration names and what a run would load,
without importing anything:

```
$ ahpd plugin list
ready @acme/agent-mine -> /home/you/.config/ahpd/node_modules/@acme/agent-mine/dist/index.js (@acme/agent-mine, Mine)
ready ./my-plugin -> /work/my-plugin/index.ts (my-plugin)
missing ./gone -> - (not resolved): Plugin ./gone is not there: tried /work/gone and /home/you/.config/ahpd/gone.
```

| State | Meaning |
| --- | --- |
| `ready` | It resolves and its manifest parses |
| `incompatible` | Its `@ahpd/sdk` range is not satisfied by the running SDK |
| `unconfigured` | `ahpd.options` names a required option the configuration does not set |
| `disabled` | The spec carries `"enabled": false` |
| `missing` | The spec does not resolve |
| `error` | The manifest does not parse or does not hold |

A plugin that would throw on load still lists as `ready`, which is the whole
reason the `ahpd` key exists: a listing must not run third-party code.

## A worked example: `@ahpd/agent-facio`

The repository ships a real backend as a plugin. `@ahpd/agent-facio` wraps the
facio agent runtime as provider `facio`, so every model an OpenAI-compatible
endpoint serves is a model inside one provider rather than a package of its
own. It is the same package an embedder imports and the same one the daemon
loads when it is named, which is the point: a plugin is not a second kind of
backend.

```bash
ahpd --plugin @ahpd/agent-facio
```

Or in the configuration file, with the backend's own options as defaults for
every session it serves:

```json
{
  "plugins": [
    {
      "name": "@ahpd/agent-facio",
      "options": {
        "provider": "facio",
        "displayName": "Facio",
        "model": "deepseek-chat",
        "baseUrl": "https://api.deepseek.com/v1",
        "store": "/var/lib/ahpd/facio"
      }
    }
  ]
}
```

| Option | |
| --- | --- |
| `provider` | The AHP provider id, `facio` when absent. Two specs with two providers are two backends |
| `displayName` | What a client draws, `Facio` when absent |
| `description` | One line about the backend |
| `model` | The model id a session that names none runs on |
| `baseUrl` | The OpenAI-compatible endpoint a session that names none uses |
| `instructions` | The system prompt the agent is created with |
| `store` | Where the facio file store lives: `$XDG_DATA_HOME/ahpd/facio`, or `~/.local/share/ahpd/facio` when that is unset. This is session data and not configuration; the harness config is read from `~/.config/facio/config.json` |
| `memory` | `true` to hold the store in memory, for a test |
| `apiKey` | The daemon's own key, or a function asked once per request so an expired one is not cached |
| `resource` | The protected resource a client authenticates against; the endpoint's origin when it is `https`, a constant otherwise |
| `adapter` | A facio `ModelAdapter` used instead of the HTTP one, for an embedder or a test |
| `policy` | The run-level policy a pause comes from, facio's own default when absent |

A session still chooses for itself. The backend publishes the choices as
config keys, and a `session/configChanged` on any of them changes what the next
turn runs:

| Session setting | |
| --- | --- |
| `model` | The model id this session runs on. Session-mutable |
| `baseUrl` | The endpoint this session runs against |
| `instructions` | The system prompt for this session |
| `permissionMode` | How tool approvals are handled. Session-mutable, and offered only when the plugin configured no `policy` |
| `effortLevel` | How hard the model is asked to think. Chat-scoped, and offered only when this backend builds the request |

The approvals mode is one of six, with the meanings the harness gives them:
`default` asks before a tool that writes, goes online or destroys anything;
`acceptEdits` lets a write inside the working directory through and asks for
everything else that a person should see; `plan` refuses anything that writes
or destroys, so the model can read and propose without changing a file;
`auto`, the default, asks only about a tool that declares itself destructive;
`bypassPermissions` runs everything; and `dontAsk` refuses whatever would have
needed approval. A `policy` passed in the plugin's options is the run-level
authority, so the mode control is not offered beside it.

The thinking level is `off`, `low`, `medium` or `high`, and it reaches the
request as `reasoning_effort`; `off` sends no reasoning field at all. Per-model
thinking levels are not offered, because an OpenAI-compatible catalogue
publishes no such thing per model.

**A key is a credential, and it is not a config key.** The backend advertises a
protected resource, and a client lends a token for it the way the protocol
says: `authenticate` with that `resource` and the token, once per connection.
The host passes what it was lent to the session. For the common case nothing
has to be lent at all, because the backend already reads where and how the
harness runs:

### The harness configuration is the default

`@ahpd/agent-facio` reads facio's own file,
`$XDG_CONFIG_HOME/facio/config.json` or `~/.config/facio/config.json`, so a
person who has already pointed the harness at a provider does not say it again
in the plugin's options. An OpenRouter file of your own, which the facio
repository also carries copyable at `examples/facio-config.example.json`, looks
like this with your key in place:

```json
{
  "providers": [
    {
      "id": "open_router",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "sk-or-v1-…"
    }
  ],
  "model": "open_router/deepseek/deepseek-chat",
  "instructions": "You are a careful assistant working in the user's project."
}
```

A model written `<provider>/<model>` selects that provider's endpoint, key and
headers from the file - the split is at the first slash, so a model id that
itself contains slashes is left whole. That is why
`open_router/deepseek/deepseek-chat` names provider `open_router` and the
OpenRouter model `deepseek/deepseek-chat`, and a model id of your own is
selected by replacing everything after that first slash. A provider may carry
extra headers, which is where OpenRouter's optional attribution ones go:
`"headers": { "HTTP-Referer": "https://example.com", "X-Title": "ahpd" }`.
Only `providers`, `model` and `instructions` are read; the theme, the shell and
the permissions belong to the harness and are not interpreted here. The file is
read once when the backend is built, so a daemon picks up an edit at its next
start.

Where a value comes from, highest first:

| Source | |
| --- | --- |
| A session setting | `model`, `baseUrl`, `instructions` chosen for one session |
| The plugin's `options` | The same keys, as defaults for every session |
| The harness file | The provider and model the harness was configured with |
| The built-in default | `http://127.0.0.1:1234/v1`, a local endpoint |

A token a client lent with `authenticate` beats every key above it; then the
plugin's own `apiKey`, then the named provider's key from the file, then the
first provider's. A missing harness file is not an error, so a machine that has
never run the harness reads an empty one and the plugin options are the only
source.

### The models a session can run on

The endpoint is asked once, `GET <baseUrl>/models`, and what it answers is what
a picker offers: every model OpenRouter routes to, or what an LM Studio holds.
Each row is offered as `<provider>/<model id>`, the same reference the harness
writes, so choosing one selects that provider's endpoint, key and headers along
with the model - and an id that itself contains slashes is carried whole,
`open_router/deepseek/deepseek-chat` being the OpenRouter model
`deepseek/deepseek-chat`. An endpoint no provider entry owns offers its models
under this backend's own provider id, which resolves to the endpoint it was
configured with.

The configured `model` is the default a session starts on, not the only model
there is: it is offered first when the endpoint's list does not carry it, and it
is the only row when the endpoint cannot be asked - so a machine that has never
run the harness, or one whose endpoint is down, still shows what a turn would
run on. A backend built with an `adapter` is never asked over the network, since
an embedder's models are the adapter's own.

A package becomes a plugin by exporting `name` and `apply` from the module its
`ahpd.entry` names, and `@ahpd/agent-facio` is no different: its `package.json`
carries the `ahpd` key and the `@ahpd/sdk` peer range shown under
[The manifest](#the-manifest), and its `apply` registers one backend built from
the options above.

## Trying one today

No plugin is published yet. From a checkout, `@ahpd/agent-facio` and the
fixtures under [`test/fixtures/`](../test/fixtures/) are real plugins and are
what the tests load:

```bash
pnpm build
node packages/server/dist/main.js --port 0 --plugin ./packages/agent-facio
node packages/server/dist/main.js --port 0 --plugin ./test/fixtures/plugin-echo
```

Load a package by its directory, not by its `src/index.ts`: the manifest names
the build, and a source file lists as `ready` without being imported, but a
load of it fails because its own `./agent.js` imports do not exist beside the
`.ts` sources. `pnpm build` is what makes the directory loadable, and
`ahpd plugin list --plugin ./packages/agent-facio` is how to check it without
starting a daemon.

`plugin-echo` contributes the example's `echo` backend and is the one to use to
watch a contributed backend serve a whole turn; `plugin-hello` contributes a
backend and a tool and refuses to create sessions. The others exist to pin a
failure: `plugin-incompatible`, `plugin-bad-manifest`, `plugin-explodes`,
`plugin-throws`, `plugin-configurable`, `plugin-plain`, `plugin-alike` and
`plugin-broken`.

A scratch plugin needs no manifest. This file is the whole of one:

```js
export const name = 'scratch';

export function apply(host) {
  host.log(`hello from ${host.path}`);
}
```

```bash
node packages/server/dist/main.js --port 0 --plugin ./scratch-plugin.mjs
```

To exercise the installed (bare name) path without publishing anything, put a
package in the configuration directory's own `node_modules` by hand and name it:

```bash
mkdir -p ~/.config/ahpd/node_modules/@acme/agent-mine
```

With that package's `package.json` and `index.js` in place, both
`ahpd plugin list --plugin @acme/agent-mine` and
`ahpd --plugin @acme/agent-mine` resolve it through the configuration
directory, which is the same path `npm i` there leaves behind.

## See also

- [docs/DAEMON.md](DAEMON.md#--plugin-and-what-naming-one-runs) - the flags, the
  configuration key and the listing from the operator's side.
- [packages/sdk/src/types/plugin.ts](../packages/sdk/src/types/plugin.ts) - the
  contract, in full.
- [.project/decisions/plugin-registration-kinds.md](../.project/decisions/plugin-registration-kinds.md)
  - why the set of kinds is closed and one method each.
