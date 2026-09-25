# Writing a plugin

A plugin is an installed package the daemon folds into the options it hands
`createHost`, so a backend, a port, a server tool or a configuration default is
an install and a configuration line rather than a fork of ahpd.

One of them is not optional. The daemon bundles no agent of its own - decision
[`the-daemon-bundles-no-agent`](../.project/decisions/the-daemon-bundles-no-agent.md) -
so every backend it serves arrives this way, `@ahpd/agent-claude` included, and
a daemon configured with none refuses to start. Reading this to add a tool or a
port, rather than to write a backend, is still reading about how the backend got
there.

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
| `registerSessionConfig(key, schema, completions?)` | register, open key | One setting a client draws on every session, merged into the backend's own schema. With a third argument, the key becomes a picker every client can draw |
| `registerResources(store)` | set | `list`, `read`, `resolve`, `complete`, and the optional write half |
| `registerResourceProvider(scheme, provider)` | register, open key | One host-owned URI scheme, routed beside the `file:` store |
| `registerTerminals(store)` | set | `create` |
| `registerChanges(source)` | set | `scopes`, `state`, `summary`, and the optional operations |
| `registerDirectories(facts)` | set | `meta`, and the optional `refresh` |
| `registerWorktrees(worktrees)` | set | `repository`, `branches`, `create`, `dirty`, `remove` |
| `registerGithub(pullRequests)` | set | `resource`, `forBranch`, `create` |
| `registerAutomations(store)` | set | the automation store |
| `registerSessions(store)` | set | the session store: flags, config, artifacts, pull requests, chat titles |
| `registerDiagnostics(diagnostics)` | set | all members optional, so `{}` is valid |
| `registerComputers(computers)` | set | how a backend runs its process in a named machine |
| `registerContainers(containers)` | set | whether a dev container can be made, made, written to, and stopped; present, the host serves `vscode/devContainers/*` and advertises the capability |

### A contributed setting can be a question

A key registered with a schema alone is a fact somebody types. A property with no `enum` is exactly that to a client, so `computer` - the key the machine plugin contributes - reached VS Code and a terminal client as a text box, and a person had to know a machine's name and spell it. Only a client holding code for that key by name could do better, which is one client rather than every client.

A third argument makes it a question:

```ts
host.registerSessionConfig('computer', {
  type: 'string',
  title: 'Computer',
  description: 'The computer://<id> this session runs in. Empty runs it on this host.',
}, async (ask) => {
  const running = await runtime.list();
  return running
    .filter((one) => one.id.includes(ask.query))
    .map((one) => ({ value: `computer://${one.id}`, label: one.id, description: one.image }));
});
```

The answerer is handed what the client asked: the `query` typed so far, and the `provider`, `workingDirectory` and the other `config` answers where the client sent them, so a picker that depends on the folder or on another setting can be written. It answers `{ value, label, description? }` rows.

The host marks the property `enumDynamic` on the way out, which is the protocol's word for "ask me", and routes `sessionConfigCompletions` for that key to the answerer. Registering the pair is what sets the flag, rather than the plugin writing it into the schema: a schema claiming it with nobody registered draws a picker that is answered with nothing, and an answerer the host was never told about is never asked. The two cannot be separated because only the registration knows both.

**The answerer is also asked once before anybody opens the picker.** `resolveSessionConfig` calls it with an empty query and fills the property's `enum`, `enumLabels` and `enumDescriptions` from what comes back, leaving `enumDynamic` set. That is a seed and not the list: the picker still asks live as somebody types.

The seed is what lets a client label the value it is already holding. VS Code's chat-input chip reads the current value out of `enum` and falls back to printing the raw value when there is none, so an unseeded `computer` drew a machine as `computer://box` and drew the empty value - "on this host" - as a chip with no text at all. A client that draws a picker only where it sees values, as the terminal and mobile clients do, saw no control whatsoever.

A key that arrives with its own `enum` is left alone, because that plugin has seeded itself.

An answerer that throws is an empty picker rather than a failed command, and a seed that throws costs that one key rather than the resolve. The person is filling in a session's settings, and a machine listing that cannot be read is not a reason to refuse them the rest of the form.

The ports are **singletons**. A plugin that supplies one the daemon already
has must say so:

```ts
host.registerResources(myStore, 'replace');
```

Without `'replace'` the value does not move and the conflict is reported. The
port names are the closed set: `agents` and `tools` are appended and cannot be
reached as ports, so no key has two spellings.

A plugin that registers the same port twice, or two agents with one `provider`,
fails its own `apply` rather than the daemon.

`registerResourceProvider` is the one **keyed** registration: the scheme is a
name the plugin invents, so two plugins can serve two schemes and neither has to
take `resources` over. `file` and anything on `ahp-` are the host's own and are
refused, and so is a scheme another plugin already registered.

A provider may also say what its scheme is for, with an optional `describe()`.
That is what a client draws a screen from before it has a URI to ask, and the
host publishes it in `_meta['ahpd.resourceProviders']` on `initialize` and on
the root state:

```ts
host.registerResourceProvider('notes', {
  read: async (uri) => ({ data: await noteAt(uri), encoding: 'utf-8' }),
  list: async () => await notes(),
  write: async (uri, content) => { await saveNote(uri, content); },
  describe: () => ({
    title: 'Notes',
    description: 'What this session wrote down.',
    manifest: { type: 'object', properties: { title: { type: 'string', title: 'Title' } } },
  }),
});
```

The host adds `root` and `operations` itself, from what the provider implements,
so a provider never claims an operation it does not serve and the map is absent
when no provider is registered. The protocol says a client must ignore a key it
does not know, and this one is `ahpd.`-prefixed, so no client is worse off for
not reading it - decision `a-resource-scheme-is-advertised-in-meta`.

```ts
host.registerResourceProvider('computer', {
  read: async (uri) => ({ data: await machineStatus(uri), encoding: 'utf-8' }),
});
```

### What a tool says about itself

A `HostTool` may carry `effects`: `reads`, `writes`, `network` and
`destructive`, each optional and nothing set when the tool does not say.
It may also carry `advancedPermission: true`, which is a different claim: the
tool does more than a session's ordinary work, so the host withholds it from
every session until `advancedTools` says otherwise. Nothing the reference host
ships declares it, so a plugin that marks a tool is asking the operator for
something rather than taking it - decision
`a-tool-says-when-it-needs-advanced-permission`.

```ts
host.registerTool({
  definition: { name: 'remove_file', description: 'Deletes a file.', inputSchema: { type: 'object', properties: {} } },
  effects: { writes: true, destructive: true },
  run: async (input, at) => { … },
});
```

It is the host's own claim, not a guarantee, and it is what a backend reads to
decide whether to ask a person. `@ahpd/agent-cofold` passes it to the runtime,
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
| `say(line)` | One line in what the daemon announces about itself |

`log` is stderr and a person reads it. `say` is stdout, which is what `ahpd status` parses, so it is where a plugin that made the host reachable somewhere new puts that address - a line only the log knows is an address nobody pastes. Say it while `listening` is being handled; the announcement is written once that event has been handled and a line offered after it is dropped.

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
| `listening` | `runtime`, `host`, `port`, `guarded` |
| `stopping` | nothing |
| `log` | `line`, the same string `onEvent` receives |

`listening` and `stopping` are the daemon's rather than the host's: a host answers connections and never opens one, so the socket is not its to report. `listening` arrives once the port is bound and before anything is announced, which makes it the place to stand up something that forwards to that port - a tunnel, a record on the network - rather than guessing the port beforehand. `stopping` arrives before the socket closes, so what was stood up has somewhere to come down. Neither is raised over stdio, where there is no address for anybody to reach.

Both are awaited like any other event, so a handler that takes three seconds to make a tunnel delays the line saying the daemon is ready. That is the intended order: a URL printed before it works is a URL somebody pastes into a client that then cannot reach it.

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
  "peerDependencies": { "@ahpd/sdk": "^0.7" },
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
`=`, and a space-separated conjunction such as `>=0.7 <0.8`. Anything it cannot
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

## A worked example: `@ahpd/agent-cofold`

The repository ships a real backend as a plugin. `@ahpd/agent-cofold` wraps the
cofold agent runtime as provider `cofold`, so every model an OpenAI-compatible
endpoint serves is a model inside one provider rather than a package of its
own. It is the same package an embedder imports and the same one the daemon
loads when it is named, which is the point: a plugin is not a second kind of
backend.

```bash
ahpd --plugin @ahpd/agent-cofold
```

Or in the configuration file, with the backend's own options as defaults for
every session it serves:

```json
{
  "plugins": [
    {
      "name": "@ahpd/agent-cofold",
      "options": {
        "provider": "cofold",
        "displayName": "Cofold",
        "model": "deepseek-chat",
        "baseUrl": "https://api.deepseek.com/v1",
        "store": "/var/lib/ahpd/cofold"
      }
    }
  ]
}
```

| Option | |
| --- | --- |
| `provider` | The AHP provider id, `cofold` when absent. Two specs with two providers are two backends |
| `displayName` | What a client draws, `Cofold` when absent |
| `description` | One line about the backend |
| `model` | The model id a session that names none runs on |
| `baseUrl` | The OpenAI-compatible endpoint a session that names none uses |
| `instructions` | The system prompt the agent is created with |
| `store` | Where the cofold file store lives: `$XDG_DATA_HOME/ahpd/cofold`, or `~/.local/share/ahpd/cofold` when that is unset. This is session data and not configuration; the harness config is read from `~/.config/cofold/config.json` |
| `memory` | `true` to hold the store in memory, for a test |
| `apiKey` | The daemon's own key, or a function asked once per request so an expired one is not cached |
| `resource` | The protected resource a client authenticates against; the endpoint's origin when it is `https`, a constant otherwise |
| `adapter` | A cofold `ModelAdapter` used instead of the HTTP one, for an embedder or a test |
| `policy` | The run-level policy a pause comes from, cofold's own default when absent |

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

`@ahpd/agent-cofold` reads cofold's own file,
`$XDG_CONFIG_HOME/cofold/config.json` or `~/.config/cofold/config.json`, so a
person who has already pointed the harness at a provider does not say it again
in the plugin's options. An OpenRouter file of your own, which the cofold
repository also carries copyable at `examples/cofold-config.example.json`, looks
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
`ahpd.entry` names, and `@ahpd/agent-cofold` is no different: its `package.json`
carries the `ahpd` key and the `@ahpd/sdk` peer range shown under
[The manifest](#the-manifest), and its `apply` registers one backend built from
the options above.

## A second worked example: `@ahpd/agent-acp`

`@ahpd/agent-acp` speaks the Agent Client Protocol to a program, so any ACP
server is one provider rather than a package of its own. It is the same package
an embedder imports and the same one the daemon loads:

```bash
ahpd --plugin @ahpd/agent-acp
```

The command is an option rather than a flag, because a plugin is named on the
command line and configured in the file:

```json
{
  "plugins": [
    {
      "name": "@ahpd/agent-acp",
      "options": {
        "provider": "copilot",
        "displayName": "Copilot",
        "command": "copilot",
        "args": ["--acp"]
      }
    }
  ]
}
```

| Option | |
| --- | --- |
| `command` | The program to spawn. **Required**: a spec with nothing to run is reported at load and skipped |
| `args` | Its arguments |
| `env` | Environment variables merged over the daemon's own |
| `cwd` | The directory it starts in, when a session names none |
| `provider` | The AHP provider id, `acp` when absent. Two specs with two commands are two backends |
| `displayName` | What a client draws, `ACP` when absent |
| `description` | One line about the backend |
| `model` | The model id a session that names none runs on |

One spec is one server, so `copilot --acp`, `codex-acp`,
`gemini --experimental-acp` and `@deepseek-ai/dsh-acp` are four configuration
lines and not four packages. The command is the only thing that tells them
apart, which is why it is the one option with no default.

GitHub Copilot CLI 1.0.87 is the one driven end to end through this bridge, by
[`scripts/acp-smoke.mts`](../scripts/acp-smoke.mts): it handshook, registered
provider `copilot`, mapped Copilot's three mode ids into the approvals control,
streamed its answer and completed with no error. Copilot keeps its session store
under `$HOME/.copilot`, so a host whose `$HOME` is read-only has to give it
`COPILOT_HOME` pointing somewhere writable.

### What the server may ask the host for

An ACP server is a client's peer, and it reaches back for files, a shell and a
person's decision. Each of those is answered through the port the daemon
already holds, and the capability is advertised on the handshake only when the
port is there - a server is never told a host can do something it cannot.

| The server asks | Answered by | Advertised when |
| --- | --- | --- |
| `fs/read_text_file` | The `resources` store, whole or as the line range asked for | The host has a `resources` port |
| `fs/write_text_file` | The same store's write half | That store can write |
| `terminal/create`, `terminal/output`, `terminal/wait_for_exit`, `terminal/kill`, `terminal/release` | The host's own shells, opened and listed by the host | The host has a `terminals` port |
| `session/request_permission` | A `chat/inputNeededSet` confirmation the person answers | Always |

The shell is the host's and not the bridge's: `terminal/create` arrives with an
argv and an environment, the host opens the terminal it would have opened for a
client, and the bridge answers with what it printed and what it exited with.

A permission is one question with two answers. ACP offers up to four options, of
which `allow_once` and `reject_once` are the two this host can honestly return:
approving picks `allow_once` and refusing picks `reject_once`, and an `always`
option is never selected because that would change the session's policy from a
single answer. A server that offers no once option is refused rather than
allowed.

A `!command` in the composer is the host's shell turn, not the server's: the
bridge implements `ran`, so the daemon spawns the command in one of its own
terminals, opens a `terminal` tool call around it and closes the turn with what
it printed. Nothing about the command reaches the ACP server, and the server is
never asked to stop for it - one already mid-prompt stays mid-prompt.

## A third worked example: a host-owned URI scheme

A plugin can serve one URI scheme itself - `computer:`, or anything else that is
not a file - without touching the filesystem store. The daemon routes every
`resource*` command by the scheme in the URI, so `file:` keeps its store and the
scheme goes to the plugin.

```ts
host.registerResourceProvider('computer', {
  // `read` is the one required member.
  read: async (uri) => ({ data: await machineStatus(uri), encoding: 'utf-8', contentType: 'application/json' }),
  // Optional, like everything else: `list`, `resolve`, `watch`, and the five write methods.
  resolve: async (uri) => ({ uri, type: 'file', size: 2, mtime: at, ctime: at }),
});
```

What a provider leaves out is what a client cannot ask for. A `computer:` with no
`list` answers `-32601` to `resourceList`, which is the same answer a read-only
store's missing write half gets, and nothing can be written unless the provider
implements a write method. `read` is required, because a provider that answers
no bytes serves nothing.

| | |
| --- | --- |
| `read(uri, wanted?)` | Required. The bytes, or the range that was asked for |
| `list(uri)` | Optional. Directory entries, for a scheme that has directories |
| `resolve(uri, followSymlinks?)` | Optional. What a URI is, for a client that browses |
| `watch(uri, options, onChange)` | Optional. `createResourceWatch` answers `-32601` without it |
| `write`, `remove`, `mkdir`, `move`, `copy` | Optional, together. A provider with none cannot be written to |

The order of authority for a URI is: a URI a connected client published is
relayed to that client first, then a registered scheme goes to its provider,
then `file:` goes to the daemon's store. A scheme nobody serves is explained as
somebody else's - `nothing here serves notes:` - rather than read as a path.

A `move` or a `copy` whose two ends are different schemes is refused `-32602`:
neither provider could carry out the other's half, which is the same answer two
different clients get for a cross-client move.

`test/fixtures/plugin-uri-resources` is a read-only `computer:` serving
`computer://local/status` and `computer://local/capabilities`, and is what the
tests load. A real `computer:` provider on this machine would talk to Docker, or
to a hypervisor handed the KVM device; the fixture starts nothing and answers for
the machine, so what it proves is the routing rather than a daemon being up.
Running one by hand, and what Docker and KVM need from the account, is
[COMPUTER.md](COMPUTER.md).

## A fourth worked example: `@ahpd/computer`

`@ahpd/computer` is the first package to serve a host-owned scheme, and the one
that makes the thing the scheme is about.

```bash
ahpd --plugin @ahpd/computer
```

It serves `computer:` read-only from a runtime - `computer://` lists the
machines, `computer://<id>/status` is the runtime's own record of one, and
`computer://<id>/capabilities` says which runtimes, limits and maximum this host
has - and it offers three tools, because a machine is made by an action and a
resource write can carry neither an image nor a limit:

| Tool | |
| --- | --- |
| `request_disposable_computer` | Start one. `image`, `cpus`, `memory` and `name` override what the host was configured with |
| `release_computer` | Stop it and remove it. Nothing on it survives |
| `computer_exec` | Run a command line inside it through `sh -lc` |

Each declares its `effects`, so a backend with a policy has something to ask a
person on. Docker is the runtime that ships, chosen by `runtime`; the command,
the image and the limits are options, and the manifest's `options` block is what
`ahpd plugin list` reads.

One package serves the scheme however many runtimes it grows, because a host
refuses a second provider for one scheme - which is why this is not
`@ahpd/computer-docker` with `@ahpd/computer-kvm` beside it.

The account the daemon runs as has to reach Docker:
`sudo usermod -aG docker "$USER"`, then a new session.
[COMPUTER.md](COMPUTER.md) has that, the same for KVM, and
`scripts/computer.mjs`, which is the operator's half: one machine, by hand, for
when no agent asked for one.

## Trying one today

`@ahpd/agent-claude` is published, and is the one a daemon needs before it will
start at all:

```bash
cd ~/.config/ahpd && npm i @ahpd/agent-claude
ahpd --plugin @ahpd/agent-claude
```

The rest are not published yet. From a checkout, `@ahpd/agent-claude`,
`@ahpd/agent-cofold`, `@ahpd/agent-acp` and the fixtures under
[`test/fixtures/`](../test/fixtures/) are real plugins and are what the tests
load:

```bash
pnpm build
node packages/server/dist/main.js --port 0 --plugin ./packages/agent-claude
node packages/server/dist/main.js --port 0 --plugin ./packages/agent-cofold
node packages/server/dist/main.js --port 0 --plugin ./packages/agent-acp
node packages/server/dist/main.js --port 0 --plugin ./test/fixtures/plugin-echo
node packages/server/dist/main.js --port 0 --plugin ./test/fixtures/plugin-uri-resources
```

Load a package by its directory, not by its `src/index.ts`: the manifest names
the build, and a source file lists as `ready` without being imported, but a
load of it fails because its own `./agent.js` imports do not exist beside the
`.ts` sources. `pnpm build` is what makes the directory loadable, and
`ahpd plugin list --plugin ./packages/agent-cofold` is how to check it without
starting a daemon.

`plugin-echo` contributes the example's `echo` backend and is the one to use to
watch a contributed backend serve a whole turn; `plugin-uri-resources`
contributes a read-only `computer:` scheme beside the filesystem store;
`plugin-hello` contributes a backend and a tool and refuses to create sessions. The others exist to pin a
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
