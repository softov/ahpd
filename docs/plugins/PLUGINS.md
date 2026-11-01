# Writing a plugin

A plugin is an installed package the daemon folds into the options it hands
`createHost`, so a backend, a port, a server tool or a configuration default is
an install and a configuration line rather than a fork of ahpd.

One of them is not optional. The daemon bundles no agent of its own - decision
[`the-daemon-bundles-no-agent-and-starts-without-one`](../../.project/decisions/the-daemon-bundles-no-agent-and-starts-without-one.md) -
so every backend it serves arrives this way, `@ahpd/agent-claude` included, and
a daemon configured with none starts but runs no session until one is installed.
Reading this to add a tool or a port, rather than to write a backend, is still
reading about how the backend got there.

This is the author's guide: the contract, what you may register, the manifest,
how a plugin is named, and what happens when one fails. The rules behind it are
in [`.project/decisions/plugin-*`](../../.project/decisions/) and the loader itself
is [packages/server/src/plugins.ts](../../packages/server/src/plugins.ts).

## The contract

A plugin is a module with named exports, in the same idiom as an `Agent`:

```ts
export const name = 'agent-mine';             // optional, the plugin's id
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

### The id

A plugin is known by its id. The id is the module's `name` export. A module without one takes the manifest's `name`, then its file name (the directory's name for an `index` file), then the spec as written. A scoped fallback has its scope joined by a dash: the manifest name `@acme/agent-mine` is the id `acme-agent-mine`. The configuration names a plugin by its `source`, and everything else names it by its id: the root config key `plugins.<id>`, the `ahpd plugin` verbs, `--plugin-option <id>.<key>=<value>` and the listing. The verbs and `--plugin-option` also take the spec as written. The id of each of ahpd's own plugins is its package name without the scope: `@ahpd/bot` is the plugin `bot`.

A `name` the module exports is a slug: lowercase letters, digits and dashes, one to forty of them, starting with a letter. A module that exports any other `name`, such as `@acme/agent-mine`, is skipped with `plugin @acme/agent-mine skipped: its name is not a slug`, and its `apply` is never called. A fallback id is held to the same rule, so a file named `My_Plugin.js` that exports no `name` is skipped with `plugin My_Plugin skipped: its name is not a slug`.

```json
{ "plugins": [{ "source": "./plugins/mine", "options": { "model": "careful" } }] }
```

When `./plugins/mine` exports `name = 'agent-mine'`, its root config key is `plugins.agent-mine` and `ahpd plugin config agent-mine` reads its options. Two specs with one id are reported, naming both, and only the first loads. The daemon imports every module it names to read its id, a module turned off with `enabled: false` too, and calls `apply` only on one that is on.

### Declaring the options

The options schema is a JSON Schema in the manifest: `ahpd.optionsSchema` in a package.json, `optionsSchema` in a standalone `plugin.json` or config entry. It is plain data with one property per option key, and the daemon reads it without importing the module, so a plugin switched off still has a form a client draws and values the daemon can refuse. The daemon merges `defaults` under the configured options and checks the result against the schema before `apply` runs, so a default satisfies a `required` key and `apply` reads values that are already the type the schema says:

```json
{
  "name": "@acme/agent-mine",
  "version": "1.0.0",
  "type": "module",
  "exports": { ".": "./dist/index.js" },
  "ahpd": {
    "entry": "./dist/index.js",
    "optionsSchema": {
      "type": "object",
      "properties": {
        "command": { "type": "string", "description": "The program to run." },
        "model": { "type": "string", "enum": ["fast", "careful"] },
        "retries": { "type": "integer", "minimum": 0 }
      },
      "required": ["command"]
    }
  }
}
```

Options that fail the schema are reported and the plugin is skipped, like any other plugin failure: `{ "source": "@acme/agent-mine", "options": { "command": 3 } }` logs `plugin agent-mine skipped: plugins.agent-mine.options.command must be text` when the module exports `name = 'agent-mine'`, and the daemon starts with its other plugins. An option key the schema does not name is logged as `plugin agent-mine: plugins.agent-mine.options.extra is not an option agent-mine knows; passed through` and still reaches `apply`. A plugin whose manifest declares no `optionsSchema` gets its options unchecked.

A module does not export its schema. One that still exports `optionsSchema` is refused with `plugin agent-mine skipped: <url> exports an optionsSchema, which the daemon no longer reads; write it in ahpd.optionsSchema of package.json, or as optionsSchema in a plugin.json for a standalone plugin`. The old `ahpd.options` flags are gone for the same reason: a package that still writes them is refused with an error naming `ahpd.optionsSchema`, because the schema's `required` list already says which options the configuration must set.

### Naming every value

Every schema a client draws has to name the value under each field, because a client that is told only `{ "type": "object" }` draws "No parameters defined." and an edit there can destroy what was written. The daemon walks each schema a plugin gives it and reports a gap; it does not refuse the plugin for one.

A gap is an object with neither `properties` nor an `additionalProperties` schema, an array with no `items`, or a field with none of `type`, `enum`, `const`, `oneOf` or `anyOf`. The walk reports it as one warning line naming the plugin, the place and the path, such as `agent-claude: engine claude env: object with no properties`, and the load continues. A bare `{}` is not a gap: it is the schema that names every JSON value, and a client draws it as JSON text.

```json
{
  "type": "object",
  "properties": {
    "env": { "type": "object", "additionalProperties": { "type": "string" } },
    "args": { "type": "array", "items": { "type": "string" } },
    "model": { "type": "string" }
  }
}
```

The walk runs on each schema a plugin registers: the manifest's `optionsSchema`, an engine's or an adapter's `schema`, each capability's `input`, a trigger's `configSchema`, an agent's `schema()` and a session config key. A backend's session config schema is made when a client asks for it, so it is walked there, once for each backend, and a gap is one line in the daemon's log. Every hole is checked when the plugin registers, so a plugin author sees it at load rather than a person seeing an empty form later.

### Marking a credential

An option the daemon would not print is one the schema marks `writeOnly`, and that is how a credential is declared. The value is checked as any other is, but no answer carries it:

```json
{
  "ahpd": {
    "entry": "./dist/index.js",
    "optionsSchema": {
      "type": "object",
      "properties": {
        "command": { "type": "string", "description": "The program to run." },
        "apiKey": { "type": "string", "writeOnly": true, "description": "The key this calls with." },
        "env": {
          "type": "object",
          "additionalProperties": { "type": "string", "writeOnly": true },
          "description": "Environment, by variable name."
        }
      },
      "required": ["command", "apiKey"]
    }
  }
}
```

A map of variables holds a credential wherever the thing it configures keeps one, so the mark goes on the values rather than on the map.

A credential is marked one of two ways, and the difference is whether the host keeps the value. `writeOnly: true` says a read never answers the value: your option is answered `<set>`, and the value stays in the file as it was written. `secret: true` says the host keeps the value in the vault: an engine's or an adapter's field marked that way is moved there on a put, and the record holds `{ "$secret": "<name>" }` in its place, so a read answers the reference and never the value.

An engine's or an adapter's schema marks a vault field `secret`. A plugin written before the keyword marks it `writeOnly`, which the host still reads as one so the value stays out of the record, and the load says so with one warning line naming the field:

```
acme: engine acme apiKey: writeOnly kept in the vault; mark it secret
```

`writeOnly` alone stays right for a plugin's own option, which the daemon reads at load and no record ever holds: `<set>` is the whole of what an answer says about it.

The mark is read wherever the schema says it, so a credential under `env`, under a tool of your own, or at the end of a list is answered as `<set>` the same way one at the top of an option is. It is honoured through `properties`, `additionalProperties`, `patternProperties` and `items`, and a value the schema does not describe at all is shown as it is, because only the declarations above say what of your options is a secret.

Root config, `GET /api/config`, `GET /api/plugin/list` and `POST /api/plugin/config` all answer such a value as `<set>`, so a client is told the key is there and is never told what it is. A client that sends `<set>` back has said the credential is left as it is, so a form sent in whole does not overwrite it with the word; another value replaces it and `null` takes it back, at either depth. What is not named is left as the file holds it, so sending one value back does not take the rest of the object with it. The terminal's `ahpd config` is the one answer that prints the file as it is.

A plugin that marks nothing is one whose options are all shown to a client holding `config:read` or `plugin:list`, so a credential it does not mark is a credential that leaks. The other way round is a plugin whose manifest declares no schema at all: nothing is known of which of its options are credentials, so all of them are answered `<set>` until it declares one.

### Naming a secret instead of holding one

An option can name a secret in the host's vault rather than carry its value, and then the value never sits in `config.json`:

```json
{ "source": "@acme/plugin-orders", "options": { "apiKey": { "$secret": "host:stripe" } } }
```

A name is `host:<name>`, `team:<team>/<name>` or `user:<id>/<name>`, and anything else is refused where it is written. The daemon reads the value while it loads you and hands `apply` the value, so your option is held to your own schema as the string it finally is - you write `{ $secret: ... }` and you receive a `string`, and there is no `$secret` in your code.

At load the name is read against the host's own scope rule: a `team:` or `user:` name is refused there, because a plugin load belongs to no team and to no person. So an option named at load is a `host:` one, and a plugin whose options cannot all be read is skipped with one line naming the option, the name and why, exactly as a schema failure is:

```
plugin acme-plugin-orders skipped: plugins.acme-plugin-orders.options.apiKey names host:stripe: the vault holds no host:stripe
```

A reference is answered as written wherever your options are shown - root config, `ahpd config`, `ahpd plugin list` - even when the option also says `writeOnly`, because a name is not a secret and `<set>` would say only that there is one. A plain text value under the same option is still answered `<set>`. The two together are what you want on an option: the name visible, the value never.

For a value you read later rather than at load, mark the option:

```ts
apiKey: { type: 'string', secretAtUse: true, description: 'The key this calls with, read from the vault when it is needed.' },
```

A node saying `secretAtUse: true` is handed to `apply` as written, references and all, so your option is a `SecretRef` rather than a `string`, and you read it yourself with `host.secret(name)`. It is the schema keyword this uses where Claude's `fromEnv: true` uses the environment, and the two answer to different needs: `fromEnv` hands you a value out of the process's environment, `secretAtUse` hands you a name out of the host's vault. See [Reading a secret](#reading-a-secret).

### Everything you are handed is read-only

Every value the host gives a plugin is a copy, so nothing you write to one
reaches the host. `PluginContext` and the `paths` in it, the `Start` a backend's
`create` receives, the turns a host tool's `context()` answers, the event a
listener is given and any `secretAtUse` option node are frozen, so writing to
one throws where you wrote it. The options object itself is your own copy, and a
write there is something only your `apply` ever sees. A plugin that moved the
principal a grant was checked against, or the session settings another plugin
registered, would be changing what the host does next, which is what this stops.

Registration ends when `apply` returns. The loader takes the host's own copy of
everything you registered and reads that from then on, so a `register*` called
later - from a timer, or from a listener - throws `<name>: nothing may be
registered after apply returned; the host has already taken its copy of what
this plugin contributed`, and an `on` registered later never fires, because the
listeners were taken at the same moment. Register what you have while you are
being applied.

This is not a sandbox, and it does not pretend to be one. A plugin is code in
the daemon's process with the daemon's permissions: it may import anything the
runtime has and patch a module another plugin imported. Naming a plugin in the
configuration is the trust decision, and what is set out here is the narrower
promise the host can keep - that nothing changes the host's state through a
value that crossed the boundary, by accident or otherwise.

## What you can register

The surface is `HostOptions` named back, so there is nothing new to learn. Every
method that contributes a value is named `register*`, and every value is checked
against its contract before it is recorded.

| Method | Operation | What it becomes |
| --- | --- | --- |
| `registerAgent(agent)` | append | A backend a client names in `createSession` |
| `registerEngine(engine)` | register, open key | One engine, whose records are the agents a client makes on `x-ahpd-agents` |
| `registerTool(tool)` | append | A server tool offered to every session's model |
| `registerSessionConfig(key, schema, completions?)` | register, open key | One setting a client draws on every session, merged into the backend's own schema. With a third argument, the key becomes a picker every client can draw |
| `registerResources(store)` | set | `list`, `read`, `resolve`, `complete`, and the optional write half |
| `registerResourceProvider(scheme, provider)` | register, open key | One host-owned URI scheme, routed beside the `file:` store |
| `registerChannel(scheme, channel)` | register, open key | One channel a client subscribes to, under an `x-` scheme; answers a handle to publish on |
| `registerAdapter(adapter)` | register, open key | One adapter, whose schema a client draws the form from, and the connectors a person makes of it |
| `registerBindings(read)` | set | One function the host asks, synchronously, for the connectors a session may use, by alias - at each tool list and each call. `@ahpd/bot` answers a bot's for the sessions it started |
| `registerMethod(name, method)` | register, open key | One command a client sends by name, under an `x-` name |
| `registerTerminals(store)` | set | `create` |
| `registerChanges(source)` | set | `scopes`, `state`, `summary`, and the optional operations |
| `registerDirectories(facts)` | set | `meta`, and the optional `refresh` |
| `registerWorktrees(worktrees)` | set | `repository`, `branches`, `create`, `dirty`, `remove`, and the optional `gitDir` |
| `registerGithub(pullRequests)` | set | `resource`, `forBranch`, `create` |
| `registerAutomations(store)` | set | the automation store |
| `registerSessions(store)` | set | the session store: flags, config, artifacts, pull requests, chat titles, the chats a session has, and the sessions it holds |
| `registerDiagnostics(diagnostics)` | set | all members optional, so `{}` is valid |
| `registerComputers(computers)` | set | how a backend runs its process in a named machine |
| `registerContainers(containers)` | set | whether a dev container can be made, made, written to, stopped and removed; present, the host serves `vscode/devContainers/*` and advertises the capability |
| `registerUsage(usage, when?)` | set | where records are kept and what a pool has been charged: `record`, `total`, `pools` and `records`, all four |
| `registerPolicies(policies, when?)` | set | where policies are kept: `list`, `get`, `put` and `remove`, all four |
| `registerVault(vault, when?)` | set | where this host's secrets are kept: `get`, `set`, `delete` and `list`, all four |
| `registerCommandParser(split, when?)` | set | reads a shell command before the terminal rules match it: `(line, shell)` in, `{ subCommands, writeDests, unanalyzable }` or `undefined` out |
| `registerRecords(store, when?)` | set | where every plugin's records are kept: `collection(name, options)` |
| `registerRoute(handler)` | register, open key | one HTTP route served on this host's own listener, under `/plugins/<name>/` |
| `registerTriggerType(definition)` | register, open key | one event trigger type an automation may be saved with, listed beside the host's own `session` and `watch` |
| `registerChatPreamble(preamble)` | append | text the host puts before the first turn of each chat a person or a tool opens |
| `registerSessionMeta(key, read)` | register, open key | one key in every session's `_meta`, answered synchronously for a session URI; `sessionMetaChanged(uri)` announces a new value |
| `registerClose(close)` | register, open key | one function the host runs when it closes, once its sessions have closed and before its stores do |

### A route authenticates its own caller

`registerRoute(handler)` takes one handler, a `Request` in and a `Response` out, and serves it on the daemon's own listener under `/plugins/<your plugin's name>/`:

```ts
export const apply: Plugin['apply'] = (host) => {
  host.registerRoute(async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname !== '/plugins/webhooks/github/hook') return new Response('No such path', { status: 404 });
    return new Response(JSON.stringify(await request.json()), { headers: { 'content-type': 'application/json' } });
  });
};
```

**Nothing stands between this and the public internet.** The request's `Host` is checked against the names this host answers to, and that is the only guard in front of your handler: there is no bearer token, and no `Origin` check, because a webhook is not a browser. **Authenticate the caller yourself** - check the signature, or a token in the path or a header - and refuse with 401 before you read the body. What your route does on the host goes through your plugin's connection, so the grants your operator wrote for your plugin are the gate on what it may do.

`@ahpd/webhook` is a plugin that does this: each endpoint names a vault secret, and a call passes only with that secret as its bearer token - [WEBHOOKS.md](WEBHOOKS.md).

One route per plugin, and the prefix is your plugin's id: a plugin that exports `name = 'webhooks'` is served under `/plugins/webhooks/`, and one that exports no `name` from the package `@acme/webhooks` is served under `/plugins/acme-webhooks/`.

The path reaches your handler whole, prefix and all, so `new URL(request.url).pathname` is the path you wrote the webhook for. The prefix is matched by whole segments: `/plugins/webhooksy/hook` reaches nothing, rather than being the start of yours.

A route is served whether `httpApi` is on or off, and on the daemon's own port rather than one of its own, so a tunnel forwards it like everything else here and no second port is opened for you. `/api` is unaffected.

The operator can move every route to a listener of its own with the daemon key `routes`, such as `"routes": { "port": 8443, "host": "0.0.0.0" }`. That listener serves `/plugins/*` and nothing else: AHP, `/api` and `/v1` answer 404 there, and `/plugins/*` answers 404 on the daemon's port. Its `Host` check takes the names of its own port, and a plugin's announced names are not among them. The daemon says where it is in a `routes on http://<host>:<port>/plugins/` line. `routes` is refused with `--stdio`, and `routes.host` is refused without `routes.port`.

A handler that throws is answered 500 with the shape of the failure, its reason goes to the daemon's log against your plugin's name, and the daemon keeps serving.

### A trigger type of your own

`registerTriggerType(definition)` adds one event trigger type beside the host's own `session` and `watch`. A person saving an automation picks it the way they pick those two, and every client is offered it by `listAutomationTriggerDefinitions` with the form your `configSchema` describes.

```ts
export const apply: Plugin['apply'] = (host) => {
  host.registerTriggerType({
    type: 'deploy',
    title: 'A deployment',
    description: 'Something a deployment did.',
    events: [
      { id: 'failed', title: 'A deployment failed', description: 'The rollout did not finish.' },
      { id: 'rolledBack', title: 'A deployment was rolled back' },
    ],
    configSchema: { type: 'object', properties: { environment: { type: 'string', title: 'Environment' } } },
  });
};
```

`type` and `title` are what the type is called, `events` needs at least one entry with an `id` and a `title`, and two events of one type may not share an id. `configSchema` is optional and is the JSON Schema a client draws the trigger's own settings from. The host holds the saved config to it when the automation is saved, and matches it against a fire's `data`, as the next paragraphs say. `session` and `watch` are the host's own names and are refused, as is a name you have already registered in this plugin, because a type is chosen by its name and two meanings for one is a choice nobody could make. Two plugins claiming one name is reported where the plugins are folded and the second loses that type alone, keeping everything else it contributed - and a name you lost is not a name you may fire, so `fireTrigger` throws for it exactly as it does for a type you never registered.

`host.fireTrigger(type, event, data, owner?)` says an event of that type happened. Every enabled automation saved with that type and that event id, and whose trigger `config` matches `data`, starts a run, under its own overlap setting, and each run's message names the event with the `title` your definition gave it. The call hands the event over and returns: it does not wait for the runs it started. A type you never registered, or an event id your type does not offer, throws rather than firing nothing.

`owner` is the owner of the connector the event came from, where it came from one. A fire that names it wakes only an automation that may read that connector: one of the same owner, or one of the host's. A fire that leaves it out is the host's own event and wakes every watcher the host lets past its other gates.

`host.runAutomation(id, data, owner?)` starts one automation by its id, or by its whole `ahp-automation:/` URI. A fire reaches every automation watching a type; this is for a plugin that knows which one it means, as a webhook connector naming its automation does. `data` rides on the run's origin as it does for a fire. An automation that is off, gone or not readable by `owner` is not run, and the host says so in its log rather than answering.

`data` is what the run is told of the event beyond its name, and it rides on the run's origin, which is where the protocol keeps a host's own provenance for a run a trigger made. It is stored with the run and read back by whoever may read the automation, so it must carry nothing secret.

```ts
host.fireTrigger('deploy', 'failed', { environment: 'production', revision: '9f2c1ab' });
```

A trigger's `config` matches `data` when every key that both hold has the same value in each, compared as JSON. A config key that `data` does not hold is a setting of the form and never blocks a run, and a config with no keys matches every fire. So the fire above runs a trigger saved with `environment: production`, and one saved with no `environment`, but not one saved with `environment: staging`. A field that must always decide the match, as `connector` does for `@ahpd/webhook`, is one your plugin puts in every fire's `data`.

Your type runs an automation exactly as the host's own do: under the same overlap mode and the same hourly cap, and acting as that automation's owner. An automation its owner may not read a session with is one this host will not run, which is the same answer a rule of that automation gets - and an automation nobody owns is run only where the daemon offers such automations every session, which is `--unowned-automations every`, its default. The run is still refused when its owner has never signed in. That is also why `{{session}}` and `{{sessionTitle}}` are filled with nothing in a message your event woke.

### A plugin is told when the host closes

`registerClose(close)` takes a function the host runs once, when it closes: after every session has closed and before the stores do. That is where a plugin stops the work it owns and nothing else knows about, a timer it armed, a removal it started, a process it spawned. A plugin that leaves that work running leaves it running for the rest of the daemon's life.

```ts
export const apply: Plugin['apply'] = (host) => {
  const timer = setTimeout(sweep, 60_000);
  host.registerClose(() => { clearTimeout(timer); });
};
```

A function may answer a promise, and the host waits for it before it closes its stores. A plugin with a removal or a child process still running waits for it here, rather than answering while it writes into something the daemon is taking away.

Called more than once, each function is kept and each runs, in the order they were registered. A failure is logged against your plugin's name and does not stop the next plugin's close. A plugin that registered none is not asked for one: having nothing to stop is the ordinary case.

### What a backend needs from a machine

A backend that can run inside a machine says so with an optional `machine()` method beside `schema()` and `defaults()`, returning what it needs by name.
The computer plugin asks the host for those needs when a machine is made and turns them into its own flags, and the machine is labelled with the agents it was prepared for, so a client is only offered machines that named yours.

A need is delivered six ways, and the field that names the way is the one that carries its value:

| Shape | What it is | What the machine gets |
| --- | --- | --- |
| `{ directory, target, readOnly? }` | a host directory | a bind mount at `target` |
| `{ file, target, readOnly? }` | a host file | a bind mount at `target` |
| `{ name, default? }` | an environment variable | `-e <name>=<value>` |
| `{ source, target }` | a host path | a `docker cp` after the create |
| `{ part, fallback? }` | one agent CLI, or ahpd itself, built by the host at the version its versions file pins | the part's own image, read-only at `/opt/ahpd/<part>` with the parts it requires beside it |
| `{ state, seed? }` | a directory the agent keeps its own configuration in | a named volume, seeded from the host files the need lists and never from a login file |

Every one of them takes `default`, `required` and `description`.
A `required` need with no value at all refuses the machine, naming the need; one without it is left out, which is how an image that already carries the thing is used.
A leading `~` is the host user's home.

The value is the profile's, then the plugin option's, then the need's own `default`, then the path the shape itself carries - so a profile can point your agent at another configuration without your being changed:

```json
{ "profiles": { "claude": { "agents": ["claude"], "needs": { "claudeConfigDirectory": "/srv/claude-home" } } } }
```

`machine()` is called when a machine is made and never at load, so a plugin that registers your agent may load after the one that makes machines.
A value that cannot work is refused there rather than made into something else: a mount or a copy-in whose value is relative or is not there, and a target two mounts land at.
The refusal names the need or the mount and where the value came from, and never an environment need's value, which may be a credential.

### A backend's worker chats

A backend that runs a subagent inside one of its tool calls asks the host for a chat of its own through the `Start` it was handed: `start.subagent(toolCallId, { title, agentName?, description?, prompt?, parentToolCallId? })`. The host is the only thing that knows what a chat URI looks like, so it mints `ahp-chat://subagent/<session>/<call>`, announces the row read-only, opens its turn with the prompt, links the spawning call with a `subagent` content and hands back `{ uri, turnId, emit, end }`. The backend writes the worker's parts through `emit` and closes its turn with `end`. A backend without it draws a worker's output inline, and the member is optional, so a backend written before this existed keeps working unchanged.

A worker's chat is read-only, but a client may still answer what the worker asked there and stop it.
A stop given there calls the backend's optional `Session.stopWorker(toolCallId)` with the call the chat was opened for, which stops that worker and leaves the lead turn running.
A backend without `stopWorker` gets `cancel` for the lead chat's running turn instead, which stops the worker with everything else that turn runs.
The Claude backend has `stopWorker`, and its `workerStop: "session"` option makes it cancel the lead turn instead.
A stop once the worker has ended is refused, as on any chat with no turn running.

### The MCP servers a session is offered

Two members of `Start` carry MCP, and both are optional, so a backend that reaches the host's tools the way it always has ignores them.

`start.mcpServers` is what the host is configured with under `mcpServers` in the daemon's `config.json`, by the name a person gave each entry, read at each session's start rather than once when the host was built. An entry is `{ type: 'stdio', command, args?, env?, cwd? }` or `{ type: 'http', url, headers? }`, and a value in `env` or `headers` is a credential. The member is absent when the host holds none, rather than an empty map. A backend that can take MCP servers uses them in whatever shape its own agent takes them; one that cannot ignores the member, which is what the in-process backends do - they reach the same servers through their own configuration.

`start.toolsServer()` opens an endpoint serving the tools bound to this session - every `registerTool` the host holds, and whatever the session's clients contributed - as one MCP server for this session alone, and answers `{ url, token, close() }` or `undefined` where no endpoint can be opened. A session opens it once and answers the same endpoint for the rest of its life, so an agent that dies and is started again over the same session is not handed a path the first one already had, which would leave two live for one session. A client's own tools are in the same list as the host's. A call to one goes to the backend's runner, which asks the client and answers with what it said. A daemon over stdio serves nothing, so it answers `undefined`, and the member is not there at all on a host built without `toolsServers`.

That is what a backend whose agent asks its client for tools needs, an ACP agent above all: it hands the agent the `url` and the `token` and the agent makes the calls. The endpoint is on the host's own listener under `/ahp-mcp/<id>`, speaks streamable HTTP JSON-RPC at revision `2025-06-18`, and answers `initialize`, `tools/list` and `tools/call` and nothing else - one message per request and a JSON answer. A tool that throws comes back as a failed call, with `isError` and the sentence in its content. The model is the one that has to be told. A client's own tool comes back the same way when the client said it failed. A notification is a `202`, and a body that is not one message a `400`.

A `GET` opens the one stream this server has. A backend that asked for `notify` is told `notifications/tools/list_changed` down it whenever the list moves, which is when a client arrives or goes. A backend that asked for `list` gets a `405` there and finds the change at its next `tools/list`. Either way the endpoint serves the list as it is now.

The token is the session's own. It names one path and no other, so a session holding it reaches its own tools and not a neighbour's, and a wrong one is a `401` before the method and before the body are read. The host closes the endpoint when the session is disposed and the path answers `404` from then on; a backend that closes it early takes it back the same way. `close()` is there for a backend that stops talking to it before the session ends - it is not the backend's job to end the session.

The host side of this is `HostOptions.toolsServers`, one `ToolsServers` from `toolServers({ origin, name, version })` that both opens the endpoints and answers the requests: its `request` takes the paths under `/ahp-mcp` and answers `undefined` for anything else, so a host serving an API of its own tries one handler and then the other. `origin()` is read when an endpoint opens rather than held, because the host is built before the port is bound; that is what `run.ts` does and why the daemon mounts `toolsServers.request` beside its own answers.

### A backend's approval options

A backend that asks before a tool call may offer the choices its own agent has, as `options` on the call's `chat/toolCallReady` and on the `toolCall` of its `toolConfirmation` entry, each a `ConfirmationOption` with an `id`, a `label`, a `kind` of `approve` or `deny` and a `group`.
The option a person picks arrives as the third argument of `Session.confirm(toolCallId, approved, optionId?)`, from the `selectedOptionId` a client sent, and the backend acts on it through its agent's own mechanism; the host keeps no approval itself.
A client that sends no option gets a plain approve or deny, which is what every backend does with `optionId` absent.
Claude offers Allow once, an "always" choice labelled by what the SDK's suggestions for the call do, and Deny, and only when the SDK suggested something; the "always" choice returns those suggestions as `updatedPermissions`.
An ACP server's own options are offered as it listed them, approvals first, and the one picked is the `optionId` the server receives.
cofold offers Allow once, Allow the tool for this session, and Deny, and the session choice is sent as `alwaysApprove`, which cofold keeps for that session and tool.
pi offers none, so a client draws approve and deny.

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
take `resources` over. A [reserved name](#reserved-names) is refused, and so is
a scheme another plugin already registered.

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
not reading it - [A resource scheme is advertised in `_meta`, and a client reads it there](../sdk/RESOURCES.md).

`operations` names what the provider implements in the words a grant is made of,
not the provider's method names: a `read` is advertised as `get` and a `write` as
`put`, so `notes:get` in a role is exactly what `resourceRead` on `notes://` asks
for. The words changed from `read` and `write` when grants stopped naming a
group - [A grant names a subject and one of its operations, and read and write are groups of those operations](../sdk/USERS.md).
Every other operation keeps its provider's name, because a resource scheme has
no other pair that differs. The scheme is a subject in the `ahpd.grants` key
beside it, under its own name and carrying those operations with the groups they
fall into, so a client drawing a role editor reads that one key rather than
joining two.

```ts
host.registerResourceProvider('computer', {
  read: async (uri) => ({ data: await machineStatus(uri), encoding: 'utf-8' }),
});
```

### Reserved names

A harness names its session channels, `claude:/<id>`, and a scheme names its
URIs, `bot://<slug>`. Both share one space with the host's own channels and
grants, so some names are refused to both:

- Anything that starts with `ahp-`, `ahpd-` or `x-`. The protocol names its
  channels with `ahp-`, this host names its own with `ahpd-`, and `x-` is the
  protocol's prefix for an extension.
- `file` and `automations`, the host's own store and channel.
- Every subject a grant names: `session`, `chat`, `user`, `team`, `role`,
  `config` and the rest of the `ahpd.grants` list.
- `http`, `https`, `ws`, `wss`, `data` and `mailto`, which a client opens itself.

Names are compared in lowercase. `registerAgent` and `registerResourceProvider`
throw for a reserved name, which fails the plugin with one problem line. A
harness and a scheme cannot share a name either: the later one is dropped with a
problem line, whichever kind it is. An agent the daemon is built with is checked
too, and a reserved one stops the host from starting.

### A channel of your own

A plugin may serve a channel: state a client subscribes to and the plugin
changes, as the host serves `ahp-automations://`. Its scheme starts with `x-`,
the protocol's extension prefix, which is why `registerChannel` takes the one
prefix the other registrations refuse - decision
.

```ts
const handle = host.registerChannel('x-notes', {
  grant: 'notes:read',
  snapshot: (uri, reader, client) => ({ notes: notesFor(reader) }),
  authorize: async (uri, reader) => ownsANote(reader),
  left: (client) => { forget(client); },
  describe: () => ({ title: 'Notes', description: 'The notes a reader may read.' }),
});

handle.publish('x-notes://', { type: 'x-notes/added', note }, {
  visible: (reader) => mayRead(note, reader),
});
```

- `grant` is what a subscribe needs. `authorize(uri, reader)` is optional, and
  is asked only of a reader the grant refused, so it can let somebody in.
- `snapshot(uri, reader, client)` is the state a subscribe answers. The reader
  is absent on a host with no users directory and on the root connection.
- `left(client)` is optional, and is called once a client watches no URI on the
  scheme on any connection: after its last unsubscribe, or when it disconnects.
- `describe()` is optional, and names the channel in `_meta['ahpd.channels']`
  on `initialize` and on the root state, as an entry `{ scheme, title,
  description?, grant }`. The title is the scheme when there is no `describe`.

A client may subscribe and may not dispatch: an action a client sends to the
channel is refused, because the state is the plugin's.

`handle.publish(uri, action, options?)` sends one action on a URI of the
scheme, and its type starts with `<scheme>/`. It throws before the host is
built. Two options narrow who gets it - decision
`a-plugin-channel-filters-each-action-per-subscriber`:

- `visible(reader, client)` is asked for each subscriber at the send, and again
  when the action is replayed to a client that reconnects. A subscriber it
  refuses, or that it throws for, is not sent the action.
- `to` names the one client id that gets it.

A subscriber that is not sent an action sees a gap in `serverSeq`. That is
allowed, because the sequence is the host's and not the channel's.
`handle.subscribers(uri)` answers who watches a URI now, as `{ client, reader }`
once per client id and person: people who share a client id are each listed,
and a send meant for one of them carries `to` and a `visible` test both.

Two plugins cannot serve one scheme: the later one is dropped with a problem
line. `@ahpd/bot` serves `x-ahpd-bots://` this way, and [BOTS.md](BOTS.md)
says what it sends.

### An adapter of your own

A plugin may offer an adapter: the form a person fills in to make one connector
of it, and the capabilities a connector of that adapter carries. The host keeps
each connector as a JSON record, and calls the adapter's `open` when one is made
and when the daemon starts with one stored.

```ts
host.registerAdapter({
  name: 'webhook',
  title: 'Webhook',
  description: 'A URL that talks to a bot or fires an automation.',
  schema: {
    type: 'object',
    properties: {
      secret: { type: 'string', secret: true, title: 'Secret', description: 'The bearer token a caller sends.' },
      bot: { type: 'string', title: 'Bot', description: 'The bot a call talks to, as bot://<name>.' },
    },
    required: ['secret'],
  },
  capabilities: [
    {
      type: 'receive',
      name: 'calls',
      title: 'Receives calls',
      description: 'Answers a POST to its URL.',
      path: '/plugins/webhook/{id}',
    },
    {
      type: 'action',
      name: 'send_message',
      title: 'Send a message',
      description: 'Sends one message to the bot this connector names.',
      input: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
  ],
  open(connector) {
    serve(connector.id, connector.config);
    return () => { stopServing(connector.id); };
  },
  run(connector, action, input) {
    return say(connector.config['bot'] as string, input['text'] as string);
  },
  async check(connector) {
    // A call that needs the key: `ok` when it is accepted, `denied` when not.
    const answer = await ping(connector.config['bot'] as string, connector.config['secret'] as string);
    return answer.ok ? { result: 'ok' } : { result: 'denied', message: answer.reason };
  },
});
```

- `name` is a slug, and is the `adapter` every connector of it records.
- `schema` is the JSON Schema a client draws the form from, and what a `put`
  checks `config` against. A field it marks `secret` is a vault field: the host
  writes the value to the vault under the owner's scope and keeps
  `{ "$secret": "<name>" }` in the record, so no record, snapshot, answer or log
  holds it. A client sends an empty value for a field it is never shown, and the
  connector keeps the secret it has. A `secret` field of a host connector may also hold `{ "fromEnv": "<NAME>" }`, the form an agent record's `env` already uses: the host reads that variable of its own environment when it opens the connector, and keeps the name in the record, which is not a secret. A team's or a person's connector that names a variable is refused, on a put and again when the record is opened, because the daemon's environment is nobody's own and a person's connector that read it could send any variable to an endpoint they choose.
- A field marked `x-ahpd-connector` with `{ "adapter": "<name>" }` names a
  connector of that adapter. It is checked when the automation whose trigger
  holds it is saved: the host refuses an id it serves no such connector for, and
  one whose owner the automation may not read. A field marked
  `x-ahpd-automation: true` names an automation, and is checked when the
  connector is put: the host refuses an id it holds no such automation for, and
  one whose owner the connector may not start. A client draws either as a list.
- `schema` is checked as a whole, so a `oneOf` with an alternative for each kind
  of connector refuses a field that belongs to another kind, rather than letting
  `open` discover it.
- `capabilities` are listed for a client. The types are `receive`, `command`,
  `action` and `models`, and `ui` is reserved for a later plan; a type this
  version does not know is shown by its title. An `action` is the one type the
  host runs, as a tool a session calls - [An action offered as a
  tool](#an-action-offered-as-a-tool).
- A `receive` capability may carry `path`: where its connectors receive, relative to the daemon's HTTP root, with `{id}` standing for the connector id, such as `/plugins/webhook/{id}`. A client puts the root before it to build a connector's URL. A `path` on any other type, or one that does not start with `/`, is refused when the adapter registers, and `x-ahpd-adapters` sends it with the capability.
- `open(connector)` starts answering for one connector, which carries `id`,
  `adapter`, `owner`, an optional `title`, and `config` with each secret read
  back from the vault. The answer is the function that stops it, or nothing when
  there is nothing to stop. An `open` that throws leaves the connector stored
  and shown as `invalid`.
- `run(connector, action, input, call?)` is optional, and runs one `action`
  capability of an open connector. `connector` is the row `open` got, secrets
  read back; `input` is what the model passed, without the `connector` argument
  when it named one. `call.files` is the folder where the calling session's
  attachments are kept, when its store keeps one; it is absent on a session
  with no folder. It answers a promise of the result, which the host hands the
  model as the tool's answer. An adapter with no `run` offers no action tool,
  and a `run` that throws is what the model is told, under the alias it named.
- `check(connector)` is optional, and says whether the connector works with a call that needs its key. `connector` is the row `open` got. It answers `{ result, message? }`: `ok` when the service accepted the key, `denied` when it refused the credentials, `unreachable` when the service did not answer, or `failed` for anything else. The host runs it after each open: a put waits for the answer, so a put says whether the key is right, and a start does not, so a slow service cannot hold it. A check that has not answered in 10 seconds counts as `unreachable`, and one that throws is `failed` with its message. An adapter with no `check` leaves its connectors with no check.

- `provider(connector)` is optional, and is how the model proxy calls a
  connector of the adapter. It answers `{ endpoint, accepts, key?, paths?,
  prefix? }`: where the provider answers, the dialects it is called in, the key
  a call goes out with, or nothing when it takes none, an optional `paths` that
  replaces one dialect's upstream path, and the first segment of a fetched
  model's name. The dialects are `openai-chat`, `anthropic-messages`,
  `anthropic-count-tokens`, `openai-input-tokens`, `openai-embeddings`,
  `openai-responses`, `openai-images`, `openai-speech`, `openai-transcriptions`
  and `rerank`. A provider that serves one path for a dialect names it, as
  OpenRouter names `/images` for `openai-images`. `connector` is the row `open`
  got, so a `secret` field is the value the vault holds. An adapter with no
  `provider` serves no model.
- `models(connector)` is optional, and answers what the connector serves: a
  promise of `{ id, name?, context_length?, pricing? }` rows, in OpenRouter's
  field names. `connector` is the row `open` got. The channel reads it on the
  connector it opened and hands the proxy a `models()` bound to that connector,
  so the config and the key never leave it. The host reads each list when the
  connector opens and again each hour, and every model in it is callable as
  `<prefix>/<id>`: `prefix` is the adapter's name, or what `provider` answers
  there. An `openai-compatible` connector has no vendor name, so it answers the
  connector's id and a local server's models are `local/llama-3`. A list that
  cannot be read keeps the one it had, and one line is written to the log. An
  adapter with no `models` serves only the names a person writes in the file.
- `signIn` is optional, and says how a person signs in to the provider in place of typing its key. `title` is the label a client prints. `field` is the `secret` field the exchange fills; a field the schema does not keep is refused at registration. `url(challenge, state)` is where a person signs in, and `exchange(code, verifier)` answers the value for `field`. The host makes the PKCE verifier and the S256 challenge, so a plugin never sees a verifier. An exchange that refuses with `HTTP <status>` alone is shown to the caller with that status, and any other message is hidden.
- An adapter whose connectors serve models declares a `models` capability. The
  capability tells a client that the proxy may call a connector of it; the
  `provider` member says where. The host lists the open connectors whose adapter
  has `provider` to the proxy, with the owner of each, and the proxy chooses
  among them. The host itself ships four: `openrouter`, `anthropic`, `openai`
  and `openai-compatible` - [The model proxy](../server/PROXY.md#adding-a-provider).

`openrouter` is the one the host ships with a `signIn`. A person signs in on OpenRouter's page, pastes the code, and the host exchanges it for the key. Both URLs are OpenRouter's public ones, so a connector's `endpoint` moves neither the sign-in nor the exchange.

The `@ahpd/activepieces` plugin makes one adapter for each Activepieces piece its `pieces` option names, and runs the actions of each in a child process - [activepieces.md](activepieces.md).

The schema can change between versions, and nothing migrates a stored
connector: one whose config no longer fits shows as `invalid`, and one whose
adapter no plugin registers shows as `unavailable`. Neither is opened.

### An engine of your own

A plugin may register an engine: the form a person fills in, the fields only
the host may set, and the `open` that builds a backend for one record. The host
keeps each agent as a JSON record, and `open` is called when one is put and when
the daemon starts with one stored. A backend that serves many agents - one per
endpoint, one per key - is an engine rather than a registration for each; the four
`@ahpd/agent-*` packages in this repository are engines.

```ts
host.registerEngine({
  name: 'claude',
  title: 'Claude Code',
  description: 'Claude Code, one record per configuration.',
  schema: { type: 'object', properties: { /* the engine's own fields */ } },
  templates: [{ name: 'Claude Code', config: {} }],
  hostOnly: ['extraArgs'],
  keyVariables: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
  open(record) {
    return claude({ provider: record.id, displayName: record.name });
  },
});
```

- `name` is a slug, and is the `engine` every record of it carries. Two plugins
  cannot register one name: the later one is dropped with a problem line.
- `title` is what a client prints for the engine, and `description` is one
  sentence on what an agent of it is.
- `icons` is what a client draws beside the engine's title.
- `schema` is the JSON Schema a client draws a record's own fields from, and
  what a put checks `config` against, before the record is written. The channel
  owns `name`, `description`, `icon` and `model` on every engine, so the schema
  holds only that engine's fields. A field it marks `secret` is a vault field, as
  is each variable in `keyVariables`: the channel keeps the value in the vault
  under `agent/<id>/<field>` in the record's owner scope, and the record holds
  `{ "$secret": "<name>" }`.
- A field the schema marks `x-ahpd-connector` with `{ "adapter": "<name>" }`, or
  a list whose `items` it marks, names connectors of that adapter by id. A put
  is refused when one names an id the host serves no such connector for, or a
  connector that is neither the record owner's nor the host's, so a person's
  agent never runs on another person's account. A record read back at a start
  is not checked, because the agents open before the connectors; the backend
  that uses a connector asks again. `@ahpd/agent-claude` names its logins
  this way.
- `templates` is what a new record starts from, each with a `name` and
  optionally a `description`, an `icon`, a `model` and a `config`. A template's
  `config` may leave a key variable empty, for the record to fill in. The host
  resolves a template's `icon` at load, as it does a plugin's, and sends the
  result as the template's `icons`.
- `templateOf` answers the template one record was made from, given the record's
  `id` and `config` and the engine's `templates`. An engine that knows this from
  the record, as `acp` knows from its `id` or its `base`, defines it. Left out,
  the host takes the template whose `config.command` equals the record's.
- `hostOnly` names the fields only a `host` record may set. A team's or a
  person's record that sets one is refused, because a field a dangerous setting
  lives in - a command a backend runs, a directory it writes - is the daemon's
  to give rather than an owner's.
- `keyVariables` names the `env` variables any owner may set, once the engine has
  a key a person would hold. Every other `env` variable is host-only, because a
  free environment can run a program, and `NODE_OPTIONS` is enough.
- `open(record)` builds the backend for one record and answers an `Agent`. The
  record is a live view rather than a copy: `id`, `engine`, `owner`, `name`,
  `description`, `icon`, `model` and `config` are read at each call, so an edit
  reaches a running session at its next turn. `config` is the engine's own values
  with each secret read back from the vault. The backend's `provider` must be
  the record's id, because a client names the agent by its id alone.

A record whose `config` no longer fits shows as `invalid`, and one whose engine no
plugin registers shows as `unavailable`; neither is opened, and neither is
removed. A put of an engine this host does not serve is refused before anything is
written.

### An action offered as a tool

An `action` capability of an adapter that has `run` is a host tool, and one
tool serves every connector of that adapter: the adapter is the kind of thing,
and a connector of it is which account a call uses. A tool is named
`<adapter>_<action>`, with each character outside `[A-Za-z0-9_]` written as
`_`, so `ap-resend` and `send_email` give `ap_resend_send_email`. Two actions
that meet on one name keep the first, and the host reports the second. The
capability's `description` is the tool's description, and its `input` is the
schema the tool starts from. The tools are made once, when the daemon starts,
and they stay when the host's own tool list is set again.

A session names its connectors by alias, in the `connectors` key of its config,
which is set when the session starts:

```json
{ "connectors": { "work": "connectors://ap-resend/account-123", "personal": "connectors://ap-resend/account-456" } }
```

An alias is a lowercase slug, and a value is `connectors://<adapter>/<id>`. A
bot names the same map in its `connectors` field, and `@ahpd/bot` answers it for
each session the bot started, through `registerBindings` - read live, so an
edit to a bot reaches a session that is already running. [BOTS.md](BOTS.md)
says what the field is.

A session sees the tool only when it binds a connector of the tool's adapter,
and the schema is that session's: with one binding there is no `connector`
argument at all, because the session has already said whose account this is,
and the host fills it in; with two or more, `connector` is required, with an
`enum` of the aliases. The model names an alias and never a connector's id.

Every call checks four things again, because a remove or a revoke changes them
while the session runs:

- the connector the alias names is one this host has, and it is ready;
- it is a connector of the tool's adapter;
- the adapter has the action, and a `run` to run it;
- the session's owner may read the connector, by the rule the connectors
  channel applies to every call.

An error names the alias the model used and the reason, and never the id or a
secret. A call after the binding is removed, or after its owner loses
`connector:list`, fails at the next call; a binding added while the session
runs shows in the next tool list the host builds for it.

### A command of your own

A plugin may serve a command: a request a client sends by name, which the
plugin answers. Its name starts with `x-`, the protocol's extension prefix, as
a channel's scheme does - A plugin serves an x- command with registerMethod. This host
names its own commands `x-ahpd/<domain>/<verb>`, such as `x-ahpd/usage/totals`,
and a plugin names its own after itself, such as `x-notes/put` - decision
An x- command is named x-ahpd/<domain>/<verb>.

```ts
host.registerMethod('x-notes/put', {
  grant: 'notes:put',
  authorize: async (params, reader) => ownsNote(reader, params.id),
  handle: async (params, reader, client, owner) => putNote(params, owner),
  describe: () => ({ title: 'Put a note', description: 'Saves one note.' }),
});
```

- `grant` is what a call needs. `authorize(params, reader)` is optional, and is
  asked only of a caller the grant refused, so it can let somebody in.
- `handle(params, reader, client, owner)` answers one request, and what it
  returns is the result. The params are the request's own. The reader is absent
  on a host with no users directory and on the root connection. The owner is
  whose work the request is, as a resource write records it: `user:<id>` or
  `plugin:<name>` for a signed-in caller, `root:<host>` for the root
  connection, and absent on a host with no users directory. An `RpcError` it
  throws is what the caller is told.
- `describe()` is optional, and names the command in `_meta['ahpd.methods']`
  on `initialize` and on the root state, as an entry `{ method, title,
  description?, grant }`. The title is the name when there is no `describe`.

A command is answered only after `initialize`, as every other command is. A
host with no users directory lets every caller in. The daemon passes its own
commands in `HostOptions.methods`, and a plugin cannot take a name the daemon
or another plugin serves: the later one is dropped with a problem line.

### What a tool says about itself

A `HostTool` may carry `effects`: `reads`, `writes`, `network` and
`destructive`, each optional and nothing set when the tool does not say.
It may also carry `advancedPermission: true`, which is a different claim: the
tool does more than a session's ordinary work, so the host withholds it from
every session until `advancedTools` says otherwise. Nothing the reference host
ships declares it, so a plugin that marks a tool is asking the operator for
something rather than taking it - decision
[A tool says when it needs advanced permission, and the host says whether it has it](../sdk/TOOLS.md).

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
| `hostName` | What this host is called, for the work nobody started as themselves |
| `configDir` | The folder the daemon keeps its own configuration in, where a plugin that has to keep a record puts its file |
| `log(line)` | One line to the daemon's log |
| `say(line)` | One line in what the daemon announces about itself |
| `problem(line)` | One item of your own you dropped, said before the daemon says it started, and a `warning` alert on the plugin's row |
| `alert(alert)` | One alert to show on the plugin's row: a `level`, a `text` and an optional `ref` |
| `clearAlert(ref)` | Takes the alert with that `ref` off the plugin's row |
| `parseYaml(text)` | A YAML text as data, read with the host's own YAML subset |
| `stringifyYaml(value)` | A value as YAML text that `parseYaml` reads back the same |
| `installed` | The absolute path of `installed/`, the folder inside the plugin's own folder where an install puts a package; nothing for a plugin with no folder of its own |
| `install(spec)` | Installs one npm package into `installed/`, and answers `{ version }` or `{ error }` |

`log` is stderr and a person reads it. `say` is stdout, which is what `ahpd status` parses, so it is where a plugin that made the host reachable somewhere new puts that address - a line only the log knows is an address nobody pastes. Say it while `listening` is being handled; the announcement is written once that event has been handled and a line offered after it is dropped.

`problem(line)` is how a plugin that handles many items says which one it could not register: `ahpd start` and `ahpd restart` print each line as `skipped: <line>` before the line that says the daemon is up, beside the problems the loader found itself. Saying one costs the item and not the plugin, which keeps the rest of your contribution and does not fail the load. Unlike the two above it is on `PluginHost` and not on the event context, because an item is dropped while `apply` runs. The same line is a `warning` alert on the plugin's row.

`alert(alert)` puts one alert on the plugin's row in the plugins channel: `{ level, text, ref? }`, where `level` is one of `notice`, `info`, `warning` and `error`. `ref` names what the alert is about, as `<kind>:<id>` such as `adapter:ap-postgres`. A client shows it beside that item, and an alert with the same `ref` replaces the one before it. `clearAlert(ref)` takes it out again. An alert raised after `apply` returned is on the row at once. The channel sends the row again, which is what a plugin holding a watch uses. A plugin holds at most 50 alerts, and the oldest goes first. A reload or an unload clears them.

`showView(view, surface?)` draws what a plugin is doing on its own page, when one sentence is not enough. It is the same road an alert takes: the daemon keeps the view on the plugin's row, a client draws it, and a new view sends the row again. `clearView(surface?)` takes it away. A reload or an unload clears it too.

A view is a small A2UI v0.10 surface, so a client needs no code for the plugin that sent it. The shape is `{ root, components }`: `root` is the `id` of the component drawn first, and `components` holds each component by its own `id`. A component has an `id`, a `component` kind, and the kind's own properties. `child` names one component below it, `children` names a list, and `action` is what a Button calls. The kinds are `Text`, `Link`, `Button`, `Card`, `Row`, `Column`, `List`, `Divider` and `Icon`.

```ts
host.showView({
  root: 'card',
  components: {
    card: { id: 'card', component: 'Card', child: 'body' },
    body: { id: 'body', component: 'Column', children: ['open', 'stop'] },
    open: { id: 'open', component: 'Link', label: 'Open', href: 'https://example.test/' },
    stop: { id: 'stop', component: 'Button', label: 'Stop', action: { event: { name: 'x-example/stop' } } },
  },
});
```

Every property is a literal value. A `{ path }` binding is refused, because this host sends no data model yet; bindings come in a later plan. A `Link` takes an absolute http(s) URL with a host. A Button's `action` is `{ event: { name, context? } }`, where `name` is an `x-` method the same plugin registered and `context` is the request's params. A person who clicks the Button sends a normal request, so the host checks the method's grant for that person. A view is one page of state, not a document: at most 200 components and 64 KiB of JSON.

`surface` says where the view is drawn, and its default is `main`, the plugin's page. `main` is the only surface this host knows. A second view on `main` replaces the first, and a plugin sends the whole view again rather than a change to it. The check names the rule it refuses: an unknown component kind, a missing component, a component two parents name, a cycle from `root`, a bad URL, an unknown method, a binding or an unknown surface.

`install(spec)` installs one npm package a plugin needs but does not ship. `installed` is the folder it installs into: `installed/` inside the plugin's own folder. `spec` is what npm takes, so a version rides in the name: `@activepieces/piece-postgres@0.5.1`. A name with no version installs the newest version at the time of the install. npm runs with `--ignore-scripts`, `--no-audit` and `--no-fund`, so a package's own install script never runs. The first install writes an `installed/package.json` of its own, so npm never changes the plugin's own manifest or `node_modules`. A source plugin is in the pnpm workspace, and its `node_modules` is not npm's to change. One install runs at a time for one plugin, and a second waits for the first. The answer is `{ version }`, the version npm left in `node_modules`, or `{ error }`, one line of npm's own error. A plugin with no folder of its own answers `{ error }`. A spec that starts with `-`, or holds whitespace, a quote or `%`, answers `{ error }` and runs no npm.

### A plugin is a client of its own host

A daemon answers connections and never opens one, so a plugin with work to do on the sessions of its own host arrives as a client does.
`host.connect()` answers the plugin's end of an in-memory connection, served by the same door a socket is, and hands back a peer: `request`, `notify` and `onMessage`.
The plugin speaks the protocol with those three and the types `@ahpd/sdk` already carries for it, so no client library is needed.

Call it from `listening` or later, which is when a host exists to accept a connection.
Asked for during `apply`, it throws a sentence saying so rather than answering a connection to nothing.
Every call answers a connection of its own, and the daemon closes each one when `stopping` is raised, so a plugin that wants a shorter life closes its own.

```ts
host.on('listening', async () => {
  const conn = host.connect();
  await conn.request('initialize', { clientId: 'bot', protocolVersions: ['0.9.0'] });
  await conn.request('createSession', { channel: 'ahp-session:/bot', provider: 'claude' });
  await conn.request('subscribe', { channel: 'ahp-chat:/bot' });
  conn.notify('dispatchAction', {
    channel: 'ahp-chat:/bot',
    action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'Say hello.' } },
  });
});
```

The connection is served as the principal `plugin:<name>`, and it may do what its configuration entry's `grants` say and nothing else.
On a host with no user directory nothing is gated, as for any other connection.
What the host says reaches the plugin through `onMessage`, and what the plugin asks for settles a promise, so the connection is used exactly as a client's socket is.

### Starting a session as an owner

A plugin that needs a session of its own - a bot, a machine that has to be talked to - has nobody at the keyboard to be, so `host.startSession(wanted)` starts one for an owner it names and answers its URI. It is the same road a client's `createSession` takes rather than a second one: the tree is isolated, the owner's grants and policies are asked about, the machine the config names is made, and the session lands in the catalogue as that owner's, which is where the person finds it afterwards.

```ts
const uri = await host.startSession({
  owner: 'user:soft',
  provider: 'claude',
  workingDirectory: '/srv/bots/motion',
  model: { id: 'claude-sonnet-5' },
  prompt: 'You review pull requests. Say what would break, in one paragraph.',
  title: 'Motion',
});
```

The owner's own `session:create` is asked first, and a refusal reads exactly as it does at the door - `soft may not session:create here` - so a plugin cannot start work the person it names could not have started themselves. A host with no users directory gates nothing, here as anywhere else. The call answers a URI or refuses, and nothing in between, so ask before you keep the answer: a record saved over a start that failed would claim a session it has not got.

`SessionRequest` carries what a `createSession` does, under the owner's name, and `owner` is the only field a caller must give. `provider` is a backend the host has and `workingDirectory` is where it works, both falling back to what a session with nothing said uses. `config` is the session's own settings and `model` is the protocol's `ModelSelection`, `{ id: 'claude-sonnet-5' }`, which rides on the session's first turn because a session has no model until a turn does. `title` is what the session is called where the plugin already knows, and a session with none is named after its first turn. `prompt` is that first turn, and leaving it out is a session that opens with nobody speaking, which is what a plugin whose new thing has nothing to open with asks for - an automation's empty message, by contrast, is an automation that does nothing. A `prompt` that is there and blank is a mistake rather than a quiet session, the same way a name written as spaces is not a name.

Two reads go with it. `host.sessionKept(uri)` answers whether this host keeps the session at a URI, which is how a plugin decides whether a leftover machine is one of its own to adopt. `host.sessionOwner(uri)` answers whose that session is, or nothing where this host has none, which is how a plugin adopts a session somebody else started - a bot linking one its owner already has - without putting work into a place its writer has no business being. Both are promises read from the host's own store when they are called, because the plugin that registers that store may load after yours.

### Starting a chat on a backend

A plugin that already has a session and needs one more conversation inside it - a bot's Back chat answering the message that woke it - says so with `host.startChat(session, wanted)`, which answers the new chat's URI. The session is named by its URI and stays what it is: its owner, its provider, its tree and its other chats.

```ts
const chat = await host.startChat('claude:/bot', {
  provider: 'cofold',
  config: { voice: 'plain' },
  prompt: 'Answer the message that woke you.',
});
```

`provider` names the backend that serves this one chat, where that is not the session's own; a chat of another backend keeps a conversation of its own, and every start of it - a session restart, `restartChat`, a rewind, a daemon restart - goes back to that backend. Absent, the chat runs on the session's own. `config` is that backend's settings for the chat, checked against its schema before anything starts, and a value it refuses is refused with the key and the value in the sentence. The session's keys that no backend owns - its `computer` and any key a plugin contributed - reach the chat from the session whatever is named here, so the chat works in the session's machine; the session backend's own keys do not, because they mean nothing to a harness that never read them. `model` is a model id within that backend, `title` names the chat, and `prompt` is its first turn, absent for a chat that opens with nobody speaking.

The session owner's own `chat:create` is asked first, and a refusal reads exactly as it does at the door - `soft may not chat:create here` - so a plugin cannot add a chat the person the session belongs to could not have added. A host with no users directory gates nothing, here as anywhere else.

A host tool reaches the same road through `ToolCall.createChat`, which takes the same `provider` and `config` beside `title`, `model` and `prompt`:

```ts
const made = await at.createChat(at.session, { provider: 'cofold', config: { voice: 'plain' }, prompt, from });
```

A chat a tool opens is counted against the session tree the tool runs in, and one a plugin starts from a wake is counted against nothing, because there is no turn behind it.

### Showing a canvas on a chat

A canvas is a page a plugin draws on the chat a person is reading. The host serves it as the protocol's canvas channel. The chat's state lists its canvases, and each one is a channel of its own holding one `CanvasState`.

| Call | Answers | What it does |
| --- | --- | --- |
| `openCanvas(chat, state)` | the canvas channel, `ahp-canvas:/<base64url(chat)>/<uuid>` | Opens a canvas on a chat this host has live, or draws an open one again |
| `updateCanvas(resource, state)` | nothing | Replaces the state of a canvas this plugin opened, whole |
| `closeCanvas(resource)` | nothing | Takes a canvas off its chat; a resource that is gone does nothing |

```ts
const state = {
  instanceId: 'board-1',
  extensionId: 'com.acme.boards',
  canvasId: 'board',
  title: 'Board',
  status: 'ready',
  url: 'https://boards.acme.test/live/board-1',
} satisfies CanvasState;
const canvas = host.openCanvas(chat, state);
host.updateCanvas(canvas, { ...state, status: 'saving' });
host.closeCanvas(canvas);
```

The state is your whole claim about the canvas, and the host draws it. `instanceId`, `extensionId` and `canvasId` are required and non-empty, and `title`, `status` and `url` are as the protocol declares them. An `open` under an `instanceId` that is already open on that chat replaces its state and answers the same channel. A canvas that is redrawn is therefore not a second one.

A canvas belongs to the plugin that opened it. Only that plugin can update or close it, and a second plugin naming another's canvas is refused. A client cannot close one either. A canvas is the plugin's claim about a page it serves, and a client that hid one would leave the plugin drawing to nobody.

`url` is one absolute http(s) URL with a host, or absent. Absent is a canvas with nothing to show. It is what a plugin says while its source is down or before it is ready, and clearing `url` is the plugin's to do. The host cannot see when something outside it went away. A URL that is not a page is refused, and the refusal names the rule rather than the URL. The host never writes a canvas URL to its log.

Ask whether a remote person can reach the URL you give. A URL on `localhost` reaches a client on that machine and no other. A plugin that must draw for a remote window therefore serves the page through [its own route](#a-route-authenticates-its-own-caller) or a public address.

The three calls are refused with `Canvases are disabled.` until a window turns `canvasesEnabled` on, and it is off by default. Turning it off leaves open canvases open and refuses the three calls after it. An unload still closes the canvases a plugin had open. That is the host taking back what the plugin drew, rather than the plugin asking.

A canvas lives as long as its chat. A chat that closes, is removed or moves to another session takes its canvases with it. A subscription to one answers `-32008` "Canvas is no longer available", and nothing survives a restart.

### Writing a usage record

`host.recordUsage(entry)` keeps one `UsageEntry` in the host's `usage` port: a model call, whose `kind` is `model`, or a stretch a computer was up, whose `kind` is `computer`. It is how a plugin says what its work cost, and the store is the host's own, so every record a daemon keeps lands in one place whichever plugin wrote it.

The entry names `pools` - the keys it is charged to - and the reader charges nothing else. Build them as [Usage is charged to the owner's, the team's and the project's pool](../sdk/USAGE.md) says: the owner as written (`user:<id>`, `root:<host>`), `team:<team>` and `project:<team>:<project>`, each only when the record has it.

Two hosts behave differently on purpose. One whose daemon carries a `usage` store keeps the record. One with no store records nothing and does not fail, because there is nowhere to write rather than a plugin that got it wrong. A store that *is* there and refuses the write throws at the caller, so say what to do with that inside your own plugin.

### Reading a secret

`host.secret(name)` answers the value behind a name in the host's vault, and is how a plugin reads one at the moment it needs it rather than at load. The second argument says whose work is reading it:

```ts
const value = await host.secret('host:stripe');
const theirs = await host.secret('team:backend/orders', { team: 'backend' });
```

A name is `host:<name>`, `team:<team>/<name>` or `user:<id>/<name>`; anything else is refused with the three forms spelled out. The scope is checked before the vault is asked, so a name out of scope never reaches the store: a `host:` name is any work's, a `team:` name is that team's, and a `user:` name is that person's, named through the second argument's `team` or `owner`. A name in scope the vault does not hold is refused too, with `the vault holds no <name>`, because a configuration file may name a secret nobody has set yet.

The scope is checked against the `work` your own call passes, so a plugin is trusted code here in a way it is nowhere else: the host decides what a name means, not whether the caller told the truth about whose work it is. Never pass a `team` or an `owner` you did not get from the work in hand.

Nobody but your own plugin ever sees the value: it comes from the vault at the call, it is not written to the configuration, and no answer this host serves carries it. A host built with no vault - a client running the contract in a test - refuses with `<name> cannot be read: this host has no vault`.

`registerVault(vault, 'replace')` takes the port over, for a store of your own: a keychain, a secrets manager, an encrypted file. The host's own is `vault.json` in the config folder, plain JSON at mode 0600, and `ahpd vault set|delete|list` is how a person fills it. A plugin listed first can take it over with `'replace'`; one that does not is refused, and one listed after the plugins that already named a secret never gets to be the vault they resolved against, so list a vault plugin first. Its own options cannot name a secret: a vault that had to read itself to build is a vault nothing can check.

### A new chat's preamble

`host.registerChatPreamble(preamble)` gives text to each new chat that a person or a tool opens.
The host asks the preamble in a client's `createChat` for a plain chat or a side chat, and in the `createChat` tool. A fork is not asked, because it resumes a conversation that already began with the preamble.
It does not ask for the first chat of a session, a subagent worker chat or a changeset chat.

```ts
host.registerChatPreamble(async ({ session, chat, origin, chats }) => {
  return session === mine ? 'You are Motion. Answer in one line.' : undefined;
});
```

The preamble gets the session, the new chat, its `origin` when it was made from another chat, and the session's other chats as `ChatSummary` rows.
It answers text, or `undefined` for none.
The host joins the answers of every preamble with a blank line, in plugin order.

The text is the hidden `context` of the chat's first turn, so the model reads it and the chat does not show it.
It comes before `initialMessage`, and a side chat gets it before the text of the turn it was made from.
A chat with no `initialMessage` runs no turn, so the text goes with the person's first message.
A preamble that throws is logged with the plugin's name, and the chat opens with the other answers.

### Keeping records

`host.records(name, options?)` opens one collection of the host's record store, and is where a plugin keeps records of its own instead of writing files. A record is a JSON object whose `id` is a slug: lowercase letters, digits and dashes, one to forty of them, starting with a letter. The store knows no plugin's record shape, so check the other fields when you read one.

```ts
const bots = host.records('bots', { body: 'instructions' });

await bots.put({ id: 'motion', name: 'Motion', owner: 'user:soft', instructions: 'You review pull requests.\n\nSay what would break.' });
const one = await bots.get('motion');
const theirs = await bots.find({ owner: 'user:soft' });
const stop = bots.watch((change) => { host.log(`${change.id} ${change.type}`); });
```

A collection has `get(id)`, `list()`, `find(match)`, `put(record)`, `remove(id)` and `watch(onChange)`. Each call but `watch` answers a promise, because a store over a database answers later. `find` answers the records whose top-level fields equal each field of `match`. `put` replaces what the id held, and refuses an id that is not a slug. `remove` answers `true` when a record was there. `watch` tells you each change as `{ id, type }`, with `type` one of `added`, `updated` and `deleted`, and answers the function that stops it.

Open a collection in `apply`. Its calls wait until every plugin has applied and the host knows its record store, so a call made early is answered late rather than refused. The name is a slug too, and a name another plugin opened is refused, so two plugins never share one. A host with no record store - a loader in a test that gave none - refuses each call with `records <name> cannot be read: this host has no record store`.

`body` names the field that holds a record's long text. The daemon's own store writes each record as `<configDir>/<name>/<id>.md`: the other fields as YAML frontmatter, and the body field as the Markdown body. It refuses a collection named `sessions`, `usage`, `automations`, `agentPlugins` or `node_modules`, because the daemon keeps its own files in those folders - `bots` is not one of them, being the bot plugin's own collection. The example above writes `bots/motion.md`:

```md
---
id: motion
name: Motion
owner: user:soft
---
You review pull requests.

Say what would break.
```

A person can edit, add or remove such a file while the daemon runs, and the collection reads it again and tells its watchers. A file that does not read, or whose `id` is not its file name, is reported in the daemon's output, and the collection keeps the record it had. A collection with no `body` writes an empty body, and a record with no body field reads back with an empty one. A `<id>.json` file with no `<id>.md` beside it is converted when the collection opens, and renamed `<id>.json.migrated`.

`registerRecords(store, 'replace')` takes the port over, for a sqlite or a postgresql store, and moves the records of every plugin at once. A store answers `collection(name, options)` with a collection that has the six calls above. `memoryRecords()` from `@ahpd/sdk` is a store that keeps everything in memory, for a test.

### Reading and writing YAML

`host.parseYaml(text)` and `host.stringifyYaml(value)` are the host's own YAML functions, so a plugin that reads a frontmatter or a skill file needs no YAML package of its own and reads a file as the host does. `parseYaml` throws on YAML it does not read. A loader that gives no YAML functions - a loader in a test - gives two that throw `no YAML on this host`.

### What a policies store has to answer

`registerPolicies(store)` contributes `HostOptions.policies`, the rows that say which agents, models and computers each person, team, project or everyone may use. Four calls, all promises: `list()` answers every row, `get(id)` and `remove(id)` work on one by id, and `put(policy)` names one or edits the one already there.

An id is unique across the store rather than per scope, because `policy://<id>` is one address and two rows behind it cannot both be read back. A body that is not a row is refused: call `checkPolicy(body)` from `@ahpd/sdk` first and it answers the row it holds, or throws an `RpcError(-32602)` naming the field that is wrong - the same check the `policy:` scheme makes, so a row a client writes and a row a plugin validates are the same rules.

`filePolicies({ file })` is the store that ships with the SDK and the daemon's own is `policies.json` in the config folder; take it over with `registerPolicies(yours, 'replace')` for a sqlite or a postgresql several daemons share. Nothing here is read until the daemon is switched on, so a plugin taking the port over changes where the rows are kept and not whether they bind.

The row, the scheme and the switch are in [POLICY.md](../sdk/POLICY.md).

### What a command parser has to answer

`registerCommandParser(split)` contributes `HostOptions.commandParser`, the reader a host uses to split a shell command line before its terminal rules match it. A host with no parser from a plugin and none from the configuration reads with the sdk's own `splitCommand`. A parser is a plugin saying it reads a line better.

The value is one function, `(line, shell) => CommandSplit | undefined`, where `shell` is `'bash'` or `'powershell'` and `CommandSplit` is `{ subCommands, writeDests, unanalyzable }`. `subCommands` are the commands the line runs, in order. The call is approved only when the rules allow every one of them and deny none. `writeDests` are the paths the line redirects a write to. A write is allowed only when its path is inside the session's working folder and `editAutoApprovePatterns` matches it. `unanalyzable` says the line could not be read as a whole, and a line with it asks.

Answer `undefined` for a line the parser cannot read: the call asks. A parser that throws, and a value that is not shaped like `CommandSplit`, are both treated as that same `undefined`. A broken parser thus asks for every command rather than approving one. The rules then check what the parser answered, and a deny rule asks rather than refusing the call. A `sed` that writes in place and a command that sets a variable for itself are denied when the parser names them.

The port is held by one party. A second plugin that sets it is refused unless it passes `'replace'`. When the configuration's `commandParser` key named a module, a plugin that sets the port without `'replace'` refuses the start rather than winning by load order. The configuration's module and `registerCommandParser` are two ways to answer the same question, and [CONFIGURE.md](../server/CONFIGURE.md#terminal-rules) describes the key.

### What is not a kind

So you do not go looking for a method that should not exist:

- **Models** are not registered. Each agent reports its own through `probe()`.
- **Slash commands** are not separate from customizations, and `Offered.commands`
  is already one projection of them.
- **UI** is not, because a client owns its screen and the host serves it
  resources.

Customizations, MCP servers and a configuration key are named in the domain
reference and not built yet; the whole list is in
[deferred.md](../../.project/plans/plugin/01-plugins-load-from-configuration/deferred.md).

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
| `session_start` | `session`, `provider`, and `client` when a client of this host created it |
| `session_end` | `session`, `reason` |
| `session_opened` | `session`, `client` |
| `turn_start` | `session`, `chat`, `turn`, and `sender` (`user:<id>` or `root:<host>`) when the host knows who sent it |
| `turn_end` | `session`, `chat`, `turn`, `status` (`complete`, `cancelled`, or `error` for a turn that ended in `chat/error`), `error` with that error's message on `error`, and `sender` as on `turn_start` |
| `message` | `session`, `chat`, `turn`, `text` |
| `tool_call` | `session`, `chat`, `tool`, `ok`, and `error` when it threw |
| `plan_update` | `session`, `chat`, `turn`, `harness`, `tool`, `title` when the session has one, `sender` when the host knows who sent the turn, and either `entries` (a whole list) or `change` (one change, with the harness's id where it names one) |
| `input_needed_set` | `session`, `chat`, `id`, `kind` |
| `input_needed_removed` | `session`, `id` |
| `client_connect` | `client` |
| `client_disconnect` | `client` |
| `authenticated` | `client`, `resource` |
| `automation_fire` | `automation`, `run` |
| `resource_write` | `uri` |
| `users_changed` | nothing |
| `terminal_open` | `terminal`, `cwd` |
| `listening` | `runtime`, `host`, `port`, `guarded` |
| `stopping` | nothing |
| `log` | `line`, the same string `onEvent` receives |

`listening` and `stopping` are the daemon's rather than the host's: a host answers connections and never opens one, so the socket is not its to report. `listening` arrives once the port is bound and before anything is announced, which makes it the place to stand up something that forwards to that port - a tunnel, a record on the network - rather than guessing the port beforehand. `stopping` arrives before the socket closes, so what was stood up has somewhere to come down. Neither is raised over stdio, where there is no address for anybody to reach.

Both are awaited like any other event, so a handler that takes three seconds to make a tunnel delays the line saying the daemon is ready. That is the intended order: a URL printed before it works is a URL somebody pastes into a client that then cannot reach it.

There is no per-token event: a plugin that wants the live stream of a turn is a
client. The `chat` on a turn event is the host's own chat URI, which is not
always the alias a client addressed it by.

`session_start` names the client that created the session where a client did,
and `session_opened` names each one that subscribed to it, or to one of its
chats, afterwards. Together they are who is in a session: a session a client
found in a list was created by nobody here, and a session an automation opened
has no client at all. `session_opened` is raised once per client and session,
so a client that subscribes to a session and then to a chat of it, or opens a
second window under another id, is heard from once per window.

An event may repeat a state action a client also receives, and is added only
for a moment a plugin acts on without watching the session - a turn's two ends,
a session that began or stopped waiting on a person - decision
[A plugin hears a session's input needed set and removed, although a client receives the same actions](PLUGINS.md).
`input_needed_set` is raised once per action, and the protocol's action is an
upsert keyed by `id`, so a handler that tracks what a session is waiting on
dedupes by `id` rather than counting.

`@ahpd/push` is one such consumer: it reads `input_needed_set` to tell a phone
that a session needs a person, and `input_needed_removed` to forget the wait.

`users_changed` says the users file changed: a person edited it, or the host
wrote it. It carries nothing, so a handler reads the principals it holds again;
their memberships and grants are read from the file at each question. The host
watches the file only while a plugin listens, and a save that touches it twice
in a moment is one event.

## The manifest

A plugin declares its manifest before it runs: a description, the categories a
client files it under, the links a person may follow, the contracts that say
what it may register, and the icons a client draws beside it. A package writes
it in the `ahpd` field of its `package.json`. A standalone plugin, which has no
package, writes it in a `plugin.json` that `plugins` names, in a `plugin.json`
beside its module, or in the `plugins` entry itself. A module does not export
its manifest, and one that still exports `manifest` is refused with the place
to move it. There is no `manifest.json`.

A standalone plugin that declares no manifest at all, with no `plugin.json` and
no `id` in its entry, is refused when it loads, and a listing says the same
line with no import: `... has no manifest: a standalone plugin writes one in a
plugin.json, with an id and a main, or in its config entry, which carries one
when it has an id.` A `plugin.json` beside the module counts, so naming
`./notes.mjs` loads the manifest in the `plugin.json` in its folder. A
`plugin.json` beside it whose `main` names another file is refused, naming
both, rather than loading a module the spec did not name.

```json
{
  "name": "@acme/agent-mine",
  "version": "1.0.0",
  "type": "module",
  "exports": { ".": "./dist/index.js" },
  "peerDependencies": { "@ahpd/sdk": ">=0.9" },
  "ahpd": {
    "entry": "./dist/index.js",
    "title": "Mine",
    "description": "A backend that runs my model.",
    "categories": ["agent"],
    "links": [{ "title": "Docs", "url": "https://example.com/mine" }],
    "contracts": { "agents": ["mine"], "tools": ["mine-*"] },
    "icons": [{ "src": "./icon.svg" }]
  }
}
```

A standalone plugin names its `plugin.json`, and its `main` names the module to
run; a spec may name the module instead, and the `plugin.json` beside it is
read. The file takes the fields above, without an enclosing `ahpd`, plus `id`,
`name` and `version`: `id` is the plugin's id, and `name` is what a listing
prints:

```json
{
  "id": "notes",
  "name": "Notes",
  "version": "1.0.0",
  "main": "./notes.mjs",
  "description": "Adds the notes channel and its command.",
  "categories": ["connector"],
  "links": [{ "title": "Repository", "url": "https://example.com/notes" }],
  "contracts": { "channels": ["x-notes"], "methods": ["x-notes/*"] }
}
```

The same manifest may be written in the entry that names the plugin, where the
entry declares its `id`:

```json
{
  "plugins": [
    {
      "id": "notes",
      "name": "Notes",
      "version": "1.0.0",
      "source": "./notes.mjs",
      "description": "Adds the notes channel and its command.",
      "categories": ["connector"]
    }
  ]
}
```

A standalone plugin's id is the `id` its manifest declares, so its module needs
no `name` export; one that exports a different name is refused, and the error
holds both names.

| Key | |
| --- | --- |
| `ahpd.entry` | What to import, when `exports` is not enough to say. It wins over `exports`, `main` and `index.js` for resolution, and a mismatch with what the package resolves to is reported |
| `ahpd.title` | What `ahpd plugin list` prints, unless the module exports its own `title` |
| `id` | A standalone plugin's id, which a package takes from its package name |
| `name` | A standalone plugin's display name, where a package writes `ahpd.title` |
| `version` | A standalone plugin's version, where a package writes its own top-level `version` |
| `main` | A standalone plugin's module, resolved against the folder of its `plugin.json` |
| `description` | One sentence on what the plugin does |
| `categories` | The groups a client files the plugin under, such as `agent` or `connector` |
| `links` | Where a person reads more, each a `{ "title", "url" }` |
| `contracts` | The names each kind of registration may use. See [the contracts](#the-contracts) |
| `icons` | What a client draws beside the plugin's name and each adapter's title. See [icons](#icons) |
| `optionsSchema` | A JSON Schema for the options `apply` receives: its `properties` are the option keys, and its `required` list is what the configuration must set before the plugin is `ready`. The daemon reads it with no import, so a plugin switched off is still listed with the form a client draws and its values are still checked. See [Declaring the options](#declaring-the-options) |
| `peerDependencies["@ahpd/sdk"]` | The compatibility range, checked **before** the module is imported. It states the oldest `@ahpd/sdk` the plugin needs |

A field is written at the top level of a standalone manifest and under `ahpd`
in a package.json, so `{ "description": "..." }` in a `plugin.json` and
`"ahpd": { "description": "..." }` in a package.json say the same thing.

Compatibility supports `*`, an exact version, `^`, `~`, `>=`, `<=`, `>`, `<`,
`=`, and a space-separated conjunction such as `>=0.8 <0.9`. Anything it cannot
read is refused by name rather than passed, so a misspelled range fails loudly
instead of loading unchecked. A package with no `peerDependencies` loads, because
absent is not incompatible.

The module is still the contract: `entry` says what to import, `apply` says what
it is. The manifest is kept on the contribution, so the plugin channel lists it
without importing the module again.

### Icons

A plugin, and each adapter it registers, may carry icons in the `Icon` shape the Agent Host Protocol defines. An icon has a `src`, and optionally a `contentType`, `sizes` and a `theme` of `light` or `dark`.

```json
"icons": [
  { "src": "./icon.svg" },
  { "src": "./icon-dark.png", "theme": "dark" }
]
```

A `src` that is a relative path is a file in the plugin's package. An adapter's path is relative to the package of the plugin that registered it. The host reads each file once, at load, and sends it to a client as a `data:image/svg+xml;base64,...` or `data:image/png;base64,...` URI. An `https:` URL is fetched once, at the same load, and sent on as a `data:` URI under the same rules as a file: a client never contacts the server a plugin names. A `data:` URI is sent as it is.

`contentType` is taken from the manifest when it gives one, and otherwise from the extension: `.svg`, `.png`, `.jpg`, `.jpeg` or `.webp`. An icon with another extension and no `contentType` is dropped. A fetched icon takes the response's `image/` type when the manifest gives none, and an answer that is not an image is dropped. An SVG with no `sizes` is sent with `["any"]`.

A `src` that starts with `mark:` names one of the marks the host ships, in `packages/server/icons/`, and any plugin may name any of them. The name is lowercase letters, digits and `-`, and the host resolves `<name>.svg` at load as it would a plugin's own file. Where `<name>-dark.svg` exists, the host sends it as a second icon with `theme: "dark"`. One template or adapter names a mark once, and a client draws the right one. The marks are `anthropic`, `cline`, `copilot`, `cursor`, `gemini`, `github`, `jira`, `linear`, `openai`, `openai-compatible`, `opencode`, `openrouter`, `qwen`, `resend` and `whatsapp`. An unknown mark, or a name with any other character, costs the icon and one line in the daemon's log.

One icon is at most 32 KB, and a larger file, a larger fetched body or a larger `data:` URI is dropped. So is a path that resolves outside the package, a file that is not there, and an `https:` URL that cannot be fetched within 5 seconds. A dropped icon costs the icon and one line in the daemon's log, and the plugin still loads. An icon of the wrong shape refuses the manifest instead, because the field is checked before the plugin loads.

A client draws an icon as an image, an `<img>` or a native image view, and never inline in the document. The host does not sanitize one: an SVG can carry a script, and drawing it as an image runs none.

### Text in the client's language

A client sends a `locale`, a BCP 47 tag such as `pt-BR`, in `initialize`. The host answers the new session form and the plugins screen in that locale. A plugin ships the text for its own fields in `ahpd.i18n`:

```json
"i18n": "i18n"
```

The value names a folder in the package. Each `<locale>.json` in it is one catalog, such as `i18n/pt.json` or `i18n/pt-BR.json`. A catalog is keyed by field path:

```json
{
  "meta": { "title": "Falado", "description": "Traz um catálogo em português." },
  "options": {
    "tone": { "title": "Tom", "description": "Como o plugin fala.", "enum": { "warm": "Caloroso" } }
  },
  "session": {
    "files": { "title": "Arquivos", "items": { "title": "Padrão" } }
  }
}
```

| Block | What it translates |
| --- | --- |
| `meta` | The plugin's `title` and `description` on the plugins screen |
| `options.<key>` | One property of the `optionsSchema` |
| `session.<key>` | One key of the new session form that the plugin declares |

Each key takes `title`, `description`, `enum.<value>` for the label of one value, and `items.title`. A key that sets `enumDynamic` keeps its labels, because its values are data.

The host looks up each string on its own. It tries the catalogs of the plugin that declared the key, then the host's own catalogs. In each, it tries the tag as given and then its language alone, so `pt.json` answers `pt` and `pt-BR`. A string that no catalog has stays in English. English is never in a catalog: it is the text the manifest and the code hold.

A catalog that does not parse costs that catalog and one line in the daemon's log. A folder outside the package is refused the same way, and the plugin still loads. `pnpm i18n` in this repository lists each catalog path that names no field.

Text the model reads, and text a person wrote, are not translated.

### The contracts

A contract key is the plural of a register method, and its entries are the names
that method may be called with:

| Key | The method it names |
| --- | --- |
| `agents` | `registerAgent(agent)`, by `provider` |
| `engines` | `registerEngine(engine)`, by the engine's name |
| `tools` | `registerTool(tool)`, by the tool's `name` |
| `sessionConfigs` | `registerSessionConfig(key, ...)`, by key |
| `resourceProviders` | `registerResourceProvider(scheme, provider)`, by scheme |
| `channels` | `registerChannel(scheme, channel)`, by scheme |
| `methods` | `registerMethod(name, method)`, by name |
| `adapters` | `registerAdapter(adapter)`, by adapter name |
| `triggerTypes` | `registerTriggerType(definition)`, by type |
| `sessionMeta` | `registerSessionMeta(key, read)`, by key |
| `ports` | every `set` registration: `registerRecords`, `registerVault`, `registerPolicies` and the rest |
| `routes` | `registerRoute(handler)`, which takes no name, so the list says only that the plugin serves one |
| `chatPreambles` | `registerChatPreamble(preamble)` |
| `plans` | `registerPlan(plan)` |
| `closers` | `registerClose(close)` |

An entry may end in `*`, such as `claude-*`, or be `*`, for a name the plugin
takes from its options. Anything else is the name exactly.

A registration the contracts do not list fails that plugin, and the line names
the method and the name:

```
plugin notes failed: plugin notes: channels needs x-note to be a name in contracts.channels
```

A contract that lists the kind but no name, because the list is empty, is
refused with `... needs the registration to be one entry in contracts.routes`.

A plugin that declares no `contracts` loads unchecked, as third-party plugins
have always done, and the plugin channel marks it `undeclared`.

## What a client sees

The daemon serves four `x-ahpd-` channels, so a client shows what a plugin adds
before a person uses it: one lists the plugins the configuration names, one the
adapters the plugins register, one the connectors made from them, and one the
agents made from the engines they register.

### `x-ahpd-plugins`

One row per configured plugin, described without running it: `spec`, `name`,
`state`, and `module`, `url`, `path`, `title` and `problem` where the daemon has
them. A row carries the manifest the daemon loaded, and `undeclared: true` when
the plugin declares no contracts. Five fields say what the running daemon did
with it:

| Field | What it says |
| --- | --- |
| `version` | The version the plugin's package.json declares, when it has one |
| `loaded` | Whether this daemon loaded it at its start |
| `alerts` | What the plugin or its loader said about it, each an `{ level, text, ref? }` alert: `error` for the line that says it did not load and `warning` for the rest. Every text has the userinfo of any URL and each `writeOnly` option value an error quoted answered `<set>`. Empty when the plugin has none |
| `views` | The view the plugin draws on its own page, by surface: `{ main: { root, components } }`. A Text's `text` and a Link's `label` come in a reader's locale when the plugin's catalog has them. Absent when the plugin shows no view, after a clear, and on a reload or an unload |
| `optionsSchema` | The form a client draws and the values `x-ahpd/plugins/options` is checked against, read from the manifest with no import, so a plugin switched off carries it too |

Reading the channel needs `plugin:list`.

Six commands change the file the daemon loads, one moves an installed package, and one reads back the text a client wrote:

| Method | Grant | What it does |
| --- | --- | --- |
| `x-ahpd/plugins/install` | `plugin:install` | Installs one source the way `ahpd plugin install` does, names the package npm wrote in `plugins` and loads it. Takes `source`; answers `{ id }`, the id the new row is listed under |
| `x-ahpd/plugins/remove` | `plugin:install` | Takes the plugin out of `plugins` and uninstalls it, or leaves the package installed with `keep: true`. Takes `id` and an optional `keep`. A plugin written by `write` has its folder deleted instead, unless `keep: true` |
| `x-ahpd/plugins/update` | `plugin:install` | Moves the plugin's package to the newest version whose `@ahpd/sdk` range admits this daemon, the way `ahpd plugin update <name>` does, and loads it again. Takes `id`; answers `{ id, from, to }`, or `{ id }` when nothing moved. A plugin the configuration names by its path is refused |
| `x-ahpd/plugins/write` | `plugin:install` | Writes a plugin in a client: `index.ts` and `package.json` in `<plugin root>/plugins/.<id>.new/`, runs `npm install` there, swaps the folder into `<plugin root>/plugins/<id>/` only when npm succeeds, names it in `plugins` and loads it. Takes `id`, `source` and `packageJson`; a second write of the same `id` replaces the files and reloads it |
| `x-ahpd/plugins/source` | `plugin:install` | Answers `{ id, source, packageJson }` with the text a client wrote. Takes `id`; a plugin the configuration names with a spec of its own is refused |
| `x-ahpd/plugins/enable` | `plugin:enable` | Turns the plugin on, keeping its entry and its options. Takes `id` |
| `x-ahpd/plugins/disable` | `plugin:disable` | Turns it off the same way. Takes `id` |
| `x-ahpd/plugins/options` | `plugin:options` | Writes one option, checked against the plugin's own schema. Takes `id`, `key` and a `value`; a `value` left out takes the option out |

The `id` is the plugin's id, which is also the row's id and the root config key
it is edited by. A value the schema marks `writeOnly` is answered `<set>`. A
running daemon loads the change before the command answers; only a plugin with a
port or a URI scheme in the way answers `restart: true`.

`plugin:install` is in neither of the plugin groups, so `plugin:write` does not
hold it: installing or removing a plugin runs code with the daemon's
permissions, and only a role given that grant by name, `plugin:*` or `*:*` may
do it. Over HTTP, `POST /plugin/install` and `/plugin/remove` ask for the same
grant in place of the deployment token, so a person holding it installs a plugin
from a client. `POST /plugin/update`, the option writes, the switch and the
restart still take the deployment token.

A command that writes moves the root's config with it: the host sends the
`root/configChanged` that carries the `plugins.<id>` values the file now holds,
so a client that reads the root after a switch reads the switch. A write the
daemon cannot apply while it runs also marks a restart as needed, for every
connection and for one that arrives afterwards: the root's config carries the
read-only value `ahpd.restartNeeded: true`, set by the host's own
`root/configChanged`, until the daemon is restarted, which clears the mark. A
client already subscribed to the root is also sent `x-ahpd/restartNeeded` with
`{ channel: "ahp-root://" }` as the mark is set. The notification is an
`x-ahpd` extension, and a client that does not know the name ignores it. It is
sent once, when the mark changes from unset to set; a second mark changes
nothing and sends nothing. A refused command marks nothing.

### `x-ahpd-adapters`

A read-only channel. One row for each adapter the loaded plugins register, keyed
by the adapter's name, holding `name`, `title`, `description`, `schema`,
`capabilities` and the `plugin` that registered it, and a `signIn` holding its
`title` and `field` when the adapter declares one. Nothing on it is an instance
of anything: the connectors made from an adapter are on `x-ahpd-connectors`.
A row shows as soon as the plugin registers the adapter, before any connector of
it exists. Reading the channel needs `connector:list`.

### `x-ahpd-connectors`

One row for each connector, keyed by its id; no adapter is on this channel. A
connector row carries its record, whose `adapter` names the adapter it is one
of, with `config` holding a reference where a secret was moved, and a `state`:

| `state` | What it says |
| --- | --- |
| `ready` | The adapter was called and is answering |
| `invalid` | Its config no longer fits its adapter's schema, or the adapter refused to open it |
| `unavailable` | No loaded plugin registers its adapter, so it cannot be opened |

A row also carries a `health` when the host knows one, and no `health` key when it knows nothing. `health.check` is the last check, `{ result, message?, at }`. `health.lastCall` is the last call the connector made or answered, `{ at, ok, status?, error? }`, and `health.lastFailure` is the last such call that failed. A call is one an `action` made through `run`, one a host part reported for the connector, as the model proxy does, or one the plugin of the connector's adapter noted with `x-ahpd/connectors/note`, as the Claude plugin notes each turn a login ran. Health is kept in memory only: a restart clears it, and the checks a start runs fill the check part again. An error message is kept as the thrower gave it, at most 500 characters.

`connector:list` opens the channel, and reads the caller's own connectors, their teams' and the host's, and no other person's. `connector:all` reads every row, and is admitted without `connector:list`. A caller with neither grant reads no connector, its own included, and is refused the subscription. A subscribe also takes `?owner=me`, which narrows the listing to the caller's own connectors.

Six commands serve a connector:

| Method | Grant | What it does |
| --- | --- | --- |
| `x-ahpd/connectors/put` | `connector:put`, and the owner's | Makes or changes `{ id, adapter, owner, title?, config }`, moves each `secret` value to the vault, writes the record and opens it. Answers the row, with the check it waited for |
| `x-ahpd/connectors/remove` | `connector:remove`, and the owner's | Closes `{ id }`, takes its secrets out of the vault and takes the record out |
| `x-ahpd/connectors/check` | `connector:put`, and the owner's | Runs the check of `{ id }` again and answers the row. It refuses a connector that is not ready, or one whose adapter has no `check` |
| `x-ahpd/connectors/note` | `connector:put`, and the owner's | Keeps one call `{ id, ok, status?, error? }` the open connector made in its `health`, and answers the row. Only the plugin that registered the connector's adapter may note, since it makes the connector's calls outside `run` |
| `x-ahpd/connectors/signin` | `connector:put`, and the owner's | Starts a sign-in for `{ id, adapter, owner, title?, config }`, checks what a put checks except the field the adapter's `signIn` names, and answers `{ url, state }`. It refuses an adapter with no `signIn` |
| `x-ahpd/connectors/signin-finish` | `connector:put`, and the owner's | Takes `{ state, code }`, asks the put's owner checks again, exchanges the code through the adapter and runs the put with the key. Answers the row |
| `x-ahpd/connectors/models` | `connector:list` for a connector the caller reads, or `connector:all` | Answers `{ models, at }` for the open provider connector `{ id }`: each model as the provider lists it, with `model`, the name a caller sends to the proxy, and `callable`, whether this caller may call it now. `at` is when the list was last read. It refuses a connector whose adapter serves no models |

A sign-in is served for an adapter that declares `signIn`, and it fills the one field that adapter names. The start makes a PKCE verifier and a state, and keeps both the verifier and the put's params in memory for ten minutes. It answers the URL the adapter builds from the S256 challenge and the state. The finish refuses a state this host never made, one that has expired, and one another caller started. It uses a state once, and only its starter can use it, so a stranger cannot burn it.

The put's grant and the owner's rule are asked again before the exchange, because ten minutes is long enough for both to change. The host keeps at most ten started sign-ins for one caller, and drops the oldest first. A failed exchange is answered with the adapter's title and the vendor's `HTTP <status>` alone. No row, error, problem line or log carries the code, the verifier, the state or the key.

The owner narrows the grant. A `host` connector needs `connector:put` to be made
and `connector:remove` to be removed, and `connector:host` beside either. A
`team:<team>` connector needs `connector:put` or `connector:remove` and a
membership of that team; it does not take `team:write`. A `user:<id>` connector
needs the caller to be that person, beside the same grant. A caller without the
grant is refused, for reading and for each method.

A `put` under a new owner removes the connector from the old one, so it also
needs what a remove by the old owner needs. It keeps nothing of the old one's
secrets, and takes the old names out of the vault. A secret field sent empty keeps the value the record
holds, because a client is never shown one to send back. The vault names are
`host:connector/<id>/<field>`, `team:<team>/connector/<id>/<field>` and
`user:<id>/connector/<id>/<field>`.

The daemon keeps its own connectors in the JSON collection `connectors`, so one
is `<configDir>/connectors/<id>.json`. The `@ahpd/webhook` plugin registers the
first kind; [WEBHOOKS.md](WEBHOOKS.md) says what an endpoint is.

### `x-ahpd-engines`

A read-only channel. One row for each engine the loaded plugins register, keyed by the engine's name, holding `name`, `title`, `description`, `schema` and the `plugin` that registered it, and `icons`, `templates`, `hostOnly` and `keyVariables` when the engine has them. An engine with no icons is sent its plugin's icons. Nothing on it is an agent: the records made from an engine are on `x-ahpd-agents`. A row shows as soon as the plugin registers the engine, before any record of it exists. Reading the channel needs `agent:list`.

### `x-ahpd-agents`

One row for each agent, keyed by its id. A row is the record - `id`, `engine`,
`owner`, `name`, `description`, `icon`, `model` and `config` - with a `state`:

| `state` | What it says |
| --- | --- |
| `ready` | The engine opened it and the host serves it |
| `invalid` | Its config no longer fits the engine's schema, the engine refused to open it, or a `$secret` in it was not in the vault |
| `unavailable` | No loaded plugin registers its engine, so it cannot be opened |

A row also carries `icons`: the icons a client draws for the agent. It is the
record's own `icon` as a one-item list when the record names one, and otherwise
the `icons` of the template the engine's `templateOf` answers, or the template
whose `config.command` equals the record's when the engine has no `templateOf`.
A record that matches no template carries no `icons` key, and the client draws a
blank square. `icon` stays on the row, so a client that reads it is not changed.

A row also carries a `health` when a check was run and none when it was not:
`health.result` is `ok`, `unreachable` or `failed`, with `message` where the
agent gave one and `at` as an ISO time. Health is kept in memory only, so a
restart clears it.

`agent:list` opens the channel, and reads the host's agents, their teams' and
the caller's own, and no other person's. `agent:all` reads every row, and is
admitted without `agent:list`. A caller with neither grant reads no agent, its
own included, and is refused the subscription. A subscribe also takes
`?owner=me`, which narrows the listing to the caller's own agents: a `host`
agent belongs to everyone and to nobody, so it is left out.

Three commands serve an agent:

| Method | Grant | What it does |
| --- | --- | --- |
| `x-ahpd/agents/put` | `agent:put`, and the owner's | Makes or changes `{ id, engine, owner, name, description?, icon?, model?, config }`, checks `config` against the engine's schema, moves each secret to the vault, writes the record, calls the engine's `open` and folds the new agent list into the running host. Answers the row |
| `x-ahpd/agents/remove` | `agent:remove`, and the owner's | Ends the sessions that run on `{ id }`, takes its secrets out of the vault and takes the record out |
| `x-ahpd/agents/check` | `agent:put`, and the owner's | Builds `{ id }` again, asks its probe and answers the row with its health. A probe that has not answered in 10 seconds is `unreachable` |

The owner narrows the grant, as it does for a connector. A `host` agent needs
`agent:put` or `agent:remove` and `agent:host` beside either. A `team:<team>`
agent needs a membership of that team, and a `user:<id>` agent needs the caller
to be that person. `agent:all` is the one grant that widens the rule: it reads
every agent and removes any, whoever owns it, which is what an operator's role
is given.

An agent's id is unique across every owner, because a client names an agent by
its id alone: a put never takes an id another record holds, and it never takes
the id of a backend the daemon or a plugin already serves. A put under a new
owner needs what a remove by the old owner needs, and keeps nothing of the old
record's secrets. A secret field sent empty keeps the value the record holds,
because a client is never shown one to send back. The vault names are
`host:agent/<id>/<field>`, `team:<team>/agent/<id>/<field>` and
`user:<id>/agent/<id>/<field>`, and a variable in `env` is a field named
`env.<VARIABLE>`, so a key is `host:agent/build/env.ANTHROPIC_API_KEY`.

A put moves a `secret` field and each `env` variable the engine names in
`keyVariables` to the vault, and keeps `{ "$secret": "<name>" }` in the record.
A host record's field may hold `{ "fromEnv": "<NAME>" }` instead, which the host
reads from its own environment when it opens the record; a team's or a person's
record that names one is refused. A record with a `$secret` the vault cannot
answer stays written and shows as `invalid`, so a key a person adds later is
picked up at the next start.

An edit keeps the agent and its sessions: the view `open` was handed is updated
in place, so a running session reads the new record at its next turn. A record
whose engine no plugin registers any more stays on disk and shows as
`unavailable`, because a plugin turned off keeps its agents.

The daemon keeps the agents in the JSON collection `agents`, so one is
`<configDir>/agents/<id>.json`.

## Naming a plugin

A plugin this repository ships is `@ahpd/<name>`, as `@ahpd/computer` is, and an
agent backend is `@ahpd/agent-<name>`, as `@ahpd/agent-acp` is; a plugin from
elsewhere takes its author's scope - decision
[A plugin package is @ahpd/<name>, and an agent backend is @ahpd/agent-<name>](PLUGINS.md).

```bash
ahpd --plugin @acme/agent-mine              # an installed package
ahpd --plugin ./my-plugin                   # a directory with a manifest
ahpd --plugin ./scratch-plugin.mjs          # a single file, with a plugin.json beside it
ahpd --plugin @acme/agent-mine --plugin ./another
ahpd --no-plugins                           # load none, whatever the file says
```

Or in the configuration file:

```json
{
  "plugins": [
    "@acme/agent-mine",
    { "source": "./my-plugin", "options": { "token": "…" }, "enabled": false },
    { "source": "@ahpd/bot", "grants": ["session:read", "session:write"] }
  ]
}
```

`source` names the module: a package, a directory or a file, written as a spec in the table below. A bare string in `plugins` is shorthand for an entry whose only key is `source`. `name` is a display name, which a listing prints instead of the id; an entry written with `name` and no `source` is the old form, and its `name` is read as the module. The daemon writes `source` the next time it changes such an entry, so an old file keeps working and moves over one entry at a time.

`--plugin` is repeatable and plugins apply in the order named. A command line
`--plugin` **replaces** the file's `plugins` list rather than adding to it, the
way `--path` replaces `paths`. `--no-plugins` beside a `--plugin` is refused as
contradictory. The options an object names are merged over the plugin's own
`defaults`, so the configuration wins.

An object may also carry `grants`, what the plugin's own connection to this
host may do. Each one is `<subject>:<operation>`, the grammar a role's grants
use - decision
[[A grant names a subject and one of its operations, and read and write are groups of those operations](../sdk/USERS.md)](../sdk/USERS.md).
None is the default, so a plugin given no `grants` may not start a session,
send a turn or run an automation. A grant that names no operation is dropped
where the plugin is loaded, and the daemon says which line it was. See
[a plugin is a client of its own host](#a-plugin-is-a-client-of-its-own-host).

### Where a spec is resolved

| Spec | Resolved |
| --- | --- |
| A bare name, `@acme/agent-mine` | Through `createRequire` against the configuration directory, so `npm i` in `~/.config/ahpd` is the install |
| A relative or absolute path | The working directory first, then the configuration directory; the absolute path that ran is logged |
| A directory | Through its manifest, in the order `ahpd.entry`, `exports["."]`, `main`, `index.js` |
| A scheme, `file:`, `npm:`, `jsr:`, `https:`, `data:` | Passed through untouched, because what an import of one means is the runtime's business |
| A bare name on Deno | Refused with a message saying to write `npm:<name>`, because Deno has no `createRequire` |

The configuration directory is `$XDG_CONFIG_HOME/ahpd` or `~/.config/ahpd`.

### Installing a plugin

`ahpd plugin install` takes every source, and so does `x-ahpd/plugins/install`: a package name such as `@ahpd/agent-pi`, with a version or a tag if the writer wants one; a path to a directory or a tarball; `github:<owner>/<repo>`; a `git+ssh:` URL; and an `https:` URL to a tarball. A source that starts with `-` is refused before npm runs, because npm would read it as an option of its own, and the sources are passed to npm after a `--` so none of them can be one. npm does the install, in the plugin root, and the install path writes into `plugins` the name npm gave the package, which is the dependency npm added to the root's `package.json`. For a package name that is the name without its version or tag. `x-ahpd/plugins/install` answers the row's own `id`, which is the id the daemon lists the new plugin under: the module is loaded before the answer, so a module that exports `name` is answered by that name, not by the package npm installed.

A bare registry name is asked of the registry before npm runs: the newest version whose `@ahpd/sdk` range admits this daemon is installed, and a package whose manifest has no `ahpd` field is refused before anything is installed. The registry cannot answer for a path, a URL or a git spec, so the package that source landed is read after npm installed it: one whose `package.json` is missing, or has no `ahpd` field, is uninstalled again and the command refuses. npm 12 runs no install script in the plugin root, so a git source that needs a build step ships the build or a `.ts` entry.

`ahpd plugin remove` takes the name `plugins` holds, which for an installed source is the package name npm wrote, and uninstalls it; `--keep` takes the entry out and leaves the package installed. A name that starts with `-` is refused before npm runs, as an install source is.

### Writing a plugin in a client

A client holding `plugin:install` writes a plugin as one TypeScript file, with `x-ahpd/plugins/write`: `{ id, source, packageJson }`, where `source` is the text of `index.ts` and `packageJson` is the manifest, as an object or as its text. The daemon writes both into `<plugin root>/plugins/.<id>.new/`, runs `npm install` in that staging folder, and only when npm succeeds swaps it into `<plugin root>/plugins/<id>/`, names the folder in `plugins` and loads it before the answer. An npm that fails leaves the folder the daemon runs untouched, and the staging folder is deleted. The folder is outside `node_modules`, which is where Node refuses to strip types, and a plugin below the plugin root resolves `@ahpd/sdk` from its own `node_modules` or from the copy the install path puts at the root.

The command completes the manifest rather than requiring the client to: `name` becomes the `id` when the manifest names none, and `ahpd.entry` becomes `./index.ts` when neither it, `exports` nor `main` names an entry. A second write of the same `id` replaces both files and reloads the plugin, so the text that runs is the text the client just sent. The replacement goes through the staging folder as the first write does, so an npm that fails on the second write leaves the first files, and the first code, exactly as they were.

`x-ahpd/plugins/source` takes `{ id }` and answers `{ id, source, packageJson }` with the text as written, so another admin reads what a colleague wrote. A plugin the configuration names by a spec of its own is refused: that file is not the daemon's to hand out. `x-ahpd/plugins/remove` deletes the folder, unless `keep: true` leaves it on disk with the entry gone from `plugins`.

## What happens when a plugin fails

A plugin is code in the daemon's process with the daemon's permissions, so
naming one is the trust decision. The configuration file is the trust boundary
here the way the connection token is the port's.

- A plugin that does not resolve, whose manifest is wrong, that throws on import, that has no `apply`, whose options fail the schema its manifest declares, or that throws out of `apply` is **reported on the daemon's log and skipped**, on stderr under `--stdio` where stdout is the protocol.
  The daemon starts without it and the next plugin is
  still tried. A bad registration loses that plugin's whole contribution rather
  than the part it registered before the mistake.
- Two plugins claiming the same agent `provider` is the one failure that
  **refuses the start**. A host built over a collision would answer a turn with
  the wrong backend, and the message names both plugins.

`ahpd plugin list` says what the configuration names and what a run would load, without applying anything. It imports each module to read its id, and prints the spec beside the id when the two differ:

```
$ ahpd plugin list
ready agent-mine (@acme/agent-mine) -> /home/you/.config/ahpd/node_modules/@acme/agent-mine/dist/index.js (@acme/agent-mine, Mine)
ready my-plugin (./my-plugin) -> /work/my-plugin/index.ts (my-plugin)
missing ./gone -> - (not resolved): Plugin ./gone is not there: tried /work/gone and /home/you/.config/ahpd/gone.
```

| State | Meaning |
| --- | --- |
| `ready` | It resolves and its manifest parses |
| `incompatible` | Its `@ahpd/sdk` range is not satisfied by the running SDK |
| `unconfigured` | The manifest's `optionsSchema` names a required option the configuration does not set |
| `disabled` | The spec carries `"enabled": false` |
| `missing` | The spec does not resolve |
| `error` | The manifest does not parse or does not hold, or the id is not a slug |

A plugin whose `apply` would throw still lists as `ready`, because a listing never calls `apply`. A module that throws on import lists under the id its manifest gives, and the rest of its row comes from the manifest, which is why the `ahpd` key exists.

## A change while the daemon runs

The daemon reads the plugin list at each start and, after that, at every write that changes it. A command that changes the file applies at once, with no restart. That covers install, remove, a plugin written in a client, update, enable, disable, an option, and a `plugins.` key written through root config. `ahpd plugin apply` applies the file as it is, without writing it.

A change loads, unloads or applies again each plugin the file describes, and the host takes a new fold of every contribution. An open session is told that its tools changed, and a route or an adapter a plugin adds is served before the command answers. A plugin that failed earlier is tried again at the next change.

A plugin enabled while the daemon runs is wired in as one loaded at start is. Its trigger types fire, its session start answers, and its session keys and plan reach a client. An automation saved for one of those types is watched from that change on.

A plugin that holds a port or a URI scheme is the one exception. The host was built over them, and a fold that moves one is refused. Enabling, disabling or reconfiguring such a plugin answers `restart: true` and changes nothing. A plugin that is loaded and then found to hold a port or a scheme goes out again. The answer is `restart: true`, with nothing loaded.

What a plugin opens while it runs, it closes in a closer registered with `host.registerClose`. An unload runs every closer the plugin registered, then drops its contribution: its tools, its agents, its routes, its adapters and its channels. A reload with new options runs them before `apply` is called again. Two applications of one plugin never hold the same socket or the same table.

An unload of a plugin that registered an agent ends every session running on that agent, before the closers run. The agent is gone from the root state afterwards, so disabling an agent plugin stops the work it served.

The code a plugin points at can move while its entry stays as it was, which no change to the file can show. `ahpd plugin reload <name>` closes the plugin and imports its module again from a URL of its own, so the code on disk now runs. `ahpd plugin update` reloads each plugin it moved. An AHP client asks with `x-ahpd/plugins/reload`, which takes `{ id }`, and needs `plugin:reload`. A plugin with a port or a URI scheme cannot be swapped, so it answers `restart: true` as it does for new options.

A name the file does not hold is a package a plugin uses. Its code has no entry to import again, so the daemon asks for a restart.

A reload costs memory. The runtime keeps the module it replaced for as long as the daemon runs, and each reload adds one more copy beside it. A restart is the only way to let them go, which is why a development loop that reloads often ends with one.

A plugin's entry is imported by URL. A `.ts` entry therefore needs Node 22.18 or newer, which strips the types as it loads, unless Bun or Deno imports it.

## A worked example: `@ahpd/agent-cofold`

The repository ships a real backend as a plugin. `@ahpd/agent-cofold` wraps the
cofold agent runtime as the engine `cofold`, so every model an
OpenAI-compatible endpoint serves is a model inside one agent rather than a
package of its own. It is the same package an embedder imports and the same one
the daemon loads when it is named, which is the point: a plugin is not a second
kind of backend.

```bash
ahpd --plugin @ahpd/agent-cofold
```

Or in the configuration file, with the backend's own options as the defaults
every record of the engine starts from:

```json
{
  "plugins": [
    {
      "source": "@ahpd/agent-cofold",
      "options": {
        "model": "deepseek-chat",
        "baseUrl": "https://api.deepseek.com/v1",
        "store": "/var/lib/ahpd/cofold"
      }
    }
  ]
}
```

Each agent is a record on `x-ahpd-agents`, and a record's id, name, description
and model belong to the channel, so none of them is an option here. The plugin
registers the engine with `registerEngine`, and its `open` builds one backend
per record with that record's values over these defaults.

| Option | |
| --- | --- |
| `model` | The model id a record that names none runs on |
| `baseUrl` | The OpenAI-compatible endpoint a record that names none uses |
| `instructions` | The system prompt a record that names none is created with |
| `store` | The folder each record's cofold file store lives under, one folder per record: `$XDG_DATA_HOME/ahpd/cofold`, or `~/.local/share/ahpd/cofold` when that is unset. This is session data and not configuration; the harness config is read from `~/.config/cofold/config.json` |
| `memory` | `true` to hold each record's store in memory, for a test |
| `tools` | Which of the four cofold capabilities a session runs, and where `web_search` gets its providers. All four are on when it is absent |
| `apiKey` | The daemon's own key, for a record that names none: `{ "$secret": "host:<name>" }` is read from the vault, or a function asked once per request so an expired one is not cached |
| `resource` | The protected resource a client authenticates against; the endpoint's origin when it is `https`, a constant otherwise |
| `adapter` | A cofold `ModelAdapter` used instead of the HTTP one, for an embedder or a test |
| `autoCompactTokens` | The estimated history size at which a session compacts, never above 80% of the model's listed context, or of 32000 when the list gave none. That 80% when absent |
| `policy` | The run-level policy a pause comes from, cofold's own default when absent |

`adapter` and `strictTools` are the plugin's alone: neither is a field of a
record. A record may name `duckduckgo` alone among the search providers,
because the channel vaults a record's top-level key fields only and a key
nested under `tools.web.search` would stay in the record.

### The tools a session runs

A cofold session gets `@cofold/tools`' four capabilities by default, so it can do what a Claude session can: read, search, edit and write files; run one command; fetch a page and, when a provider is configured, search the web; and keep memory.
cofold runs them in its own process, on the machine the daemon runs on, and the permission mode is what confines them rather than the workspace.

In `default` a write, a command, a web fetch and a read outside the workspace each ask first; a session that names no mode gets `auto`, where a read, inside or outside, and a web fetch run and a write or a command asks.
The workspace check resolves symlinks with cofold's own resolver, so a write through a symlink that leaves the workspace, including one whose target does not exist yet, is outside it and `acceptEdits` asks for it too.

`web_fetch` refuses loopback, private and link-local addresses on every hop.
The machine's public address is not among them, and a name that answers with a different address at the connection than at the check is not caught.

The daemon draws each call, asks through the approvals mode, and reports a file an edit changed to the changeset.
An approval offers Allow once, Allow the tool for this session, and Deny; the session choice reaches cofold as `alwaysApprove`, and cofold answers that tool's next asks in the session itself.
A shell call is drawn as a terminal with its bare command, and a call that is declined or cut short never leaves a file held as changing.
A session opened with no working directory keeps its tools and works in the daemon's current directory.

A turn with no model in the session settings, the record, the plugin options or the cofold configuration file fails with a sentence that says to add `"model"`, as `"<provider>/<model>"`, to `$XDG_CONFIG_HOME/cofold/config.json` or `~/.config/cofold/config.json`.

`tools` turns one off by naming it `false`, and gives `web_search` its providers:

```json
{
  "plugins": [
    {
      "source": "@ahpd/agent-cofold",
      "options": {
        "tools": {
          "shell": false,
          "web": { "search": { "brave": { "apiKey": "…" }, "duckduckgo": true } }
        }
      }
    }
  ]
}
```

`web_search` is offered only when `tools.web.search` names at least one of `brave` and `tavily`, each with an `apiKey`, or `duckduckgo`, which is `true` and needs no key.
The named providers are tried in the order the configuration lists them, and a failing one is skipped.
Name none of them and the session has `web_fetch` alone, with no `web_search` to offer.

Memory is files under `<store>/memory/<workspace slug>/`, where `<store>` is the folder of the record the session runs on - the plugin's `store` under the record's id, or the record's own `store` when it names one - and `$XDG_DATA_HOME/ahpd/cofold/<id>` when the plugin named no store either, so a session's memory sits beside its sessions and can be read and edited by hand.
Memory is per workspace and shared by the sessions in it, so what one session writes there reaches the next.
A session whose store is held in memory (`memory: true`) has no directory for memory files, so it gets the other three.

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

`@ahpd/agent-cofold` reads cofold's own file, `$COFOLD_CONFIG` or
`$XDG_CONFIG_HOME/cofold/config.json` or `~/.config/cofold/config.json`, so a
person who has already pointed the harness at a provider does not say it again
in the plugin's options. `COFOLD_CONFIG` is what a machine sets, since it is the
one place a path can be moved for cofold alone. An OpenRouter file of your own,
which the cofold repository also carries copyable at
`examples/cofold-config.example.json`, looks
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
| The record | The same keys, as they are written for one agent |
| The plugin's `options` | The same keys, as defaults for every record |
| The harness file | The provider and model the harness was configured with |
| The built-in default | `http://127.0.0.1:1234/v1`, a local endpoint |

A token a client lent with `authenticate` beats every key above it; then the
record's own `apiKey`, then the plugin's, then the named provider's key from the
file, then the first provider's. A missing harness file is not an error, so a
machine that has never run the harness reads an empty one and the record and the
plugin options are the only source.

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
command line and configured in the file. One entry serves every ACP server, and
each agent is a record of the engine `acp`:

```json
{
  "plugins": [
    { "source": "@ahpd/agent-acp", "options": { "hostTools": true } }
  ]
}
```

| Option | |
| --- | --- |
| `hostTools` | Offer the host's own tools to each session as an MCP server, on by default. A record may set its own |
| `toolsChanged` | How each session's agent hears that the tools it listed have moved, over each record's own. `notify` by default |

A record of the engine, as `x-ahpd/agents/put` takes it:

| Field | |
| --- | --- |
| `base` | The shipped row this record takes, for an id that is not itself one. **Host records only** |
| `command` | The program to spawn. **Required** for a record that names no row and no `base`. **Host records only** |
| `args` | Its arguments, replacing the row's own. **Host records only** |
| `env` | Environment variables merged over the daemon's own, by variable name. A value written `{ "$secret": "host:<name>" }` is read from the vault |
| `cwd` | The directory it starts in, when a session names none. **Host records only** |
| `authenticate` | The sign-in to send after the handshake, as `{"methodId": "api-key"}` for Codex with a key |
| `hostTools` | Whether this agent's sessions are offered the host's own tools, over the plugin-wide setting |
| `honoursTrust` | Whether this agent asks before it loads a project's own settings and hooks. Absent, a session of it in a folder the host did not vouch for is refused rather than started, because ACP carries no trust field |
| `toolsChanged` | How this agent hears that the tools it listed have moved, over the plugin-wide setting: `notify` holds a stream open and sends `notifications/tools/list_changed` down it, and `list` says nothing |
| `install` | How to install this agent, by system, as the vendor's own docs give it. **Host records only** |
| `page` | The vendor's install page, for a system the install lines do not cover |
| `machine` | What a machine needs to run this agent: `env`, variables set only inside the machine, and `copy`, host paths copied in. See below. **Host records only** |

The record's id is the provider a client names, and its `name`, `description`,
`icon` and `model` belong to the channel, so they are not fields here. The engine
is registered with `registerEngine`, and it carries a template for each
shipped row: each template holds its row's command, arguments, sign-in, trust
rule and machine, and the vendor's key variables set empty, so a record made
from `codex` starts as Codex and a record made from `copilot` starts as Copilot.
A record that writes its own `command` names a server nobody has heard of, and
is an agent like any other.

An edit applies at the next turn: the plugin reads the record again at the start
of each turn, and starts the child again on the same conversation through
`session/resume` or `session/load` when the program or its settings changed. A
record that cannot be built - a `base` naming no shipped row, no `command` where
one is needed, an `authenticate` with no `methodId`, a `$secret` the vault does
not hold, or a `machine` that is wrongly written or reads a variable the daemon
does not have - is stored and shown as `invalid` with one line naming it.

A record's `machine` says what a [machine](COMPUTERS.md) needs to run it, and it
reaches only a machine: a session on this host is spawned without any of it.

```json
{
  "id": "codex",
  "engine": "acp",
  "owner": "host",
  "name": "Codex",
  "config": {
    "machine": {
      "env": {
        "CODEX_HOME": "/ahpd/codex",
        "CODEX_API_KEY": { "fromEnv": "CODEX_API_KEY" }
      },
      "copy": [{ "source": "~/.codex/config.toml", "target": "/ahpd/codex/config.toml" }]
    }
  }
}
```

Each `env` variable is a machine need named `<record>.<VARIABLE>`, here
`codex.CODEX_HOME`, and each `copy` entry one named `<record>.copy.<n>`, so a
computer profile's `needs` can give any of them another value. A
`{ "fromEnv": "NAME" }` value is the daemon's `NAME` when the record opens. A
value written `{ "$secret": "<scope>:<name>" }` is read from the
[vault](../server/VAULT.md) when the machine is made, for the machine's owner,
and is passed by name on each command rather than given when the machine is
made; one the vault cannot answer refuses that machine alone.

A session in a machine is offered the host's tools only where the machine can
reach the daemon: for now, where the endpoint's address is neither loopback nor
a wildcard bind such as `0.0.0.0` or `::`. Otherwise they are left out and the
log says `host tools: computer://box cannot reach the daemon at 127.0.0.1:8080,
so they were left out`.

The shipped rows are `codex`, `gemini`, `copilot`, `opencode`, `kilo`, `goose`,
`pi`, `dsh`, `devin`, `cursor`, `amp`, `qwen`, `cline` and `omp`, so
`gemini --acp`, `codex-acp` and `@deepseek-ai/dsh-acp` are three records and not
three packages. Only a record that is written is served, so an ACP agent's
binary that is not installed costs nothing until somebody makes one. A row that
names a variable in `fromEnv` sends that sign-in only when the daemon's
environment or the record's `env` has the variable, and for a session placed in
a machine also when the record's `machine.env` sets it.

The `codex` CLI has no ACP mode of its own; `codex-acp` is Codex behind an
adapter, installed with `npm i -g @agentclientprotocol/codex-acp`. The
`@zed-industries/codex-acp` package it replaced no longer gets updates.

A server that refuses a session until it has been signed in, which is Codex
with a key and Cursor, is given one by the `authenticate` option: the
handshake lists the ids it takes, and the option names the one to send. The
bridge never picks that id itself, so a name the server did not offer fails
the turn saying which it did. A server that asks to be signed in later, on
`session/new` or on a prompt, ends the turn as `chat/error` with type
`authRequired` and a sentence naming the same ids.

`session/new` and `session/load` carry `Start.mcpServers` in ACP's own shapes, less what the server's handshake says it cannot take - an `http` server goes out only where it answered `mcpCapabilities.http`, and one left out is said through the log, `api: this ACP server takes no MCP server over HTTP, so it was left out`, because a deployment that configured a server and watched a session not reach it has no other way to find out. The host's own tools are added last as one `http` server named `ahp`, carrying the endpoint's bearer token, unless `hostTools` is `false`; that one goes through the same check as the rest, so a server that takes none over HTTP is told nothing about it, and one left out is said as `ahp: this ACP server takes no MCP server over HTTP, so it was left out`. `ahp` is the name the in-process server already carries in this host, so an agent with both is being told about the same tools twice rather than about two servers. A daemon over stdio opens no endpoint and adds nothing. A stdio server's `cwd` cannot be carried by ACP at all, so it is left out of the shape that goes out and said, `search: ACP carries no directory for a stdio MCP server, so /srv/search was left out`.

GitHub Copilot CLI 1.0.87 is the one driven end to end through this bridge, by
[`scripts/acp-smoke.mts`](../../scripts/acp-smoke.mts): it handshook, registered
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
| `elicitation/create` | A `chat/inputRequested` question the person answers, and `chat/inputCompleted` back | Always |

The shell is the host's and not the bridge's: `terminal/create` arrives with an
argv and an environment, the host opens the terminal it would have opened for a
client, and the bridge answers with what it printed and what it exited with.

A permission offers every option the server listed, approvals before refusals, on the call and on its confirmation entry, and the one the person picks is the `optionId` the server receives.
An answer that picked no option, or one the server did not offer, selects `allow_once` or `reject_once`, and an `always` option is never selected that way because that would change the session's policy from a single answer.
A server that offers no once option of the answer's kind is answered `cancelled`.

`elicitation/create` is a server asking a person something, and the bridge asks
it on the chat as a `chat/inputRequested` question. Each field of the form
becomes one question, and the session raises the `session/inputNeededSet` entry
a permission raises. The person's answer arrives as `chat/inputCompleted` and
goes to the server as the elicitation's content, and the kind the client sent
goes as itself: a decline as a decline, and a cancel as a cancel, which are two
different things to tell a server. A page rather than a form carries its `url`
on the request and is completed by the server's own `elicitation/complete`. A
question still standing when a turn is stopped is answered `cancel`.

A tool call moves when the agent moves it.
A call the server is still holding is `pending`, and nothing is said about who approves it until the agent starts it, so a permission that arrives one instruction later is never contradicted.
Once a question is standing it is the call's readiness: a later status or a later `rawInput` sends the arguments again if they arrived after, and never sends a ready saying nobody is going to be asked.
The arguments are kept on the call as well, so a call announced `pending` with them is readied with them by the update that starts it, even where that update carries a status alone.
A call that arrives already finished is started, readied and completed at once, whether it arrived as a `tool_call` or as a `tool_call_update`.

What the call carries is what a client draws beside it.
Terminal content is the host's own terminal, the one the server opened through the host, and it draws with the same block a `!command` turn closes with.
A diff is shown as the file edit it is, the after side being the file itself, and recorded in the turn's changeset beside the before side the diff carried - by the time the diff arrives the file holds only the new text, so that before side is the diff's own `oldText`.
A diff with no `oldText` is a file the agent created, which the changeset says by leaving the before side out.
A diff of a path outside the session's own directories is shown and not recorded, because it is something the agent says it did somewhere this session was never given.
Every file the agent writes through `fs/write_text_file` is captured the same way, once before the write and once after it, and the before is read before the write truncates the file.

A `!command` in the composer is the host's shell turn, not the server's: the
bridge implements `ran`, so the daemon spawns the command in one of its own
terminals, opens a `terminal` tool call around it and closes the turn with what
it printed. Nothing about the command reaches the ACP server, and the server is
never asked to stop for it - one already mid-prompt stays mid-prompt.

A command that is not there fails the turn that asked for it in a sentence naming
what was wrong, and leaves the daemon and every other session alone. A server that
dies fails its turn the same way, with the last of what it wrote on stderr under
the exit code; the next turn spawns it again and reopens the conversation it was
holding, and a server that cannot reopen one says so rather than answering with an
empty conversation. Closing a session tells the server to close it where it
advertised it can be, and signals the whole process group that server leads, so
nothing it started is left running.

A conversation is reopened with `session/resume` where the server advertises
`sessionCapabilities.resume` and the host already holds its turns. Everywhere
else it is reopened with `session/load`, whose replay is the only record for a
conversation this process never watched. A resume replays nothing, so the turns
the host handed over seed this bridge's own record of the conversation.

A fork is offered for the last turn of a session, and only where the server
advertises `sessionCapabilities.fork` - a capability ACP marks unstable, which
most servers do not offer. `session/fork` copies the whole conversation the
server holds and takes no cut, so no earlier turn has a fork point. A fork asked
for at any other turn is refused with a sentence, rather than served as a copy
that still holds the turns after it.

## A third worked example: a host-owned URI scheme

A plugin can serve one URI scheme itself - `computer:`, or anything else that is
not a file - without touching the filesystem store. The daemon routes every
`resource*` command by the scheme in the URI, so `file:` keeps its store and the
scheme goes to the plugin.

`@ahpd/push` serves a second one: a device registers its Expo push token by
writing `push://devices/<install id>`, which makes it the one scheme here that
exists to be written to rather than read from.

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

`packages/server/test/fixtures/plugin-uri-resources` is a read-only `computer:` serving
`computer://local/status` and `computer://local/capabilities`, and is what the
tests load. A real `computer:` provider on this machine would talk to Docker, or
to a hypervisor handed the KVM device; the fixture starts nothing and answers for
the machine, so what it proves is the routing rather than a daemon being up.
Running one by hand, and what Docker and KVM need from the account, is
[COMPUTERS.md](COMPUTERS.md).

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
[COMPUTERS.md](COMPUTERS.md) has that, the same for KVM, and
`scripts/computer.mjs`, which is the operator's half: one machine, by hand, for
when no agent asked for one.

## Trying one today

`@ahpd/agent-claude` is published, and is the one a daemon needs before it will
start at all:

```bash
ahpd plugin install @ahpd/agent-claude
ahpd --plugin @ahpd/agent-claude
```

The rest are not published yet. From a checkout, `@ahpd/agent-claude`,
`@ahpd/agent-cofold`, `@ahpd/agent-acp` and the fixtures under
[`packages/*/test/fixtures/`](../../packages/server/test/fixtures/) are real plugins and are what the tests
load:

```bash
pnpm build
node packages/server/dist/main.js --port 0 --plugin ./packages/agent-claude
node packages/server/dist/main.js --port 0 --plugin ./packages/agent-cofold
node packages/server/dist/main.js --port 0 --plugin ./packages/agent-acp
node packages/server/dist/main.js --port 0 --plugin ./packages/server/test/fixtures/plugin-echo
node packages/server/dist/main.js --port 0 --plugin ./packages/server/test/fixtures/plugin-uri-resources
```

Load a package by its directory, not by its `src/index.ts`: the manifest names
the build, and a source file lists as `ready`, because a listing that cannot import it takes the manifest's id, but a load of it fails because its own `./agent.js` imports do not exist beside the `.ts` sources. `pnpm build` is what makes the directory loadable, and
`ahpd plugin list --plugin ./packages/agent-cofold` is how to check it without
starting a daemon.

`plugin-echo` contributes the example's `echo` backend and is the one to use to
watch a contributed backend serve a whole turn; `plugin-uri-resources`
contributes a read-only `computer:` scheme beside the filesystem store;
`plugin-hello` contributes a backend and a tool and refuses to create sessions. The others exist to pin a
failure: `plugin-incompatible`, `plugin-bad-manifest`, `plugin-explodes`,
`plugin-throws`, `plugin-configurable`, `plugin-plain`, `plugin-alike` and
`plugin-broken`.

A scratch plugin declares a manifest like any other standalone plugin. These two
files in one folder are the whole of one, and the manifest is the first:

`plugin.json`:

```json
{
  "id": "scratch",
  "main": "./scratch-plugin.mjs"
}
```

`scratch-plugin.mjs`:

```js
export const name = 'scratch';

export function apply(host) {
  host.log(`hello from ${host.path}`);
}
```

```bash
node packages/server/dist/main.js --port 0 --plugin ./scratch-plugin.mjs
```

Naming either file loads the plugin: the `plugin.json` names the module, and
the module names the `plugin.json` beside it. An entry in `config.json` with an
`id` carries the same manifest instead, for a module kept with no `plugin.json`
of its own.

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

- [docs/server/PLUGINS.md](../server/PLUGINS.md) - the flags, the
  configuration key and the listing from the operator's side.
- [packages/sdk/src/types/plugin.ts](../../packages/sdk/src/types/plugin.ts) - the
  contract, in full.
- .project/./PLUGINS.md
  - why the set of kinds is closed and one method each.
