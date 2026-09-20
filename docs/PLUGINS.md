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

## Trying one today

No plugin is published yet. From a checkout, the fixtures under
[`test/fixtures/`](../test/fixtures/) are real plugins and are what the tests
load:

```bash
pnpm build
node packages/server/dist/main.js --port 0 --plugin ./test/fixtures/plugin-echo
```

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
