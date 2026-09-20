---
title: Plugins, beyond agents
created: 2026-09-20
---

`agents-as-extensions.md` is the narrow case: a second backend is a config key rather than a rebuild.
The hole is wider than backends.
`packages/server/src/main.ts` is one literal that names `claude({ paths })` and every port, so a second backend, a second resource store, a session hook or a root config key are all the same edit and the same rebuild.
A plugin is the install-time unit for all of them, and this file is its shape.
The name is plugin, not extension, everywhere in ahpd.

## What the two references do

Both were read for this, and neither is copied whole.

`/github/pi` (`packages/coding-agent`) loads a module whose default export is `(pi: ExtensionAPI) => void | Promise<void>`.
It discovers from `.pi/extensions`, `~/.pi/agent/extensions` and configured paths, loads TypeScript through `jiti` with no build step, and registers tools, commands, flags, providers, renderers, input transforms and permission gates onto a per-plugin record that is then bound to a runtime.
Its code runs in the daemon's process with the user's permissions and no sandbox, and project-local code waits on a project trust decision.

`/github/deepseek-harness` uses the vendored cordis loader under `vendor/cordis`.
Its plugins are named exports `name`, `inject`, `Config` and `apply` with no default export, because `Loader.unwrapExports` takes `exports.default ?? exports` and a stray default silently drops `inject`.
Services are published as `ctx.<name>` and a plugin's load order falls out of what it injects rather than out of file order.
Every registration returns a disposer, `ctx.effect` runs them in reverse on unload, and changed modules hot reload.
Users add one with `dsh plugin add` into a profile, and nothing is rebuilt.

Three lessons carry over and one does not.
Carry over: plugin code is installed by a package manager and enabled by configuration; contributions are registrations with a natural order; compatibility is npm semver and peer dependencies rather than a runtime `apiVersion` string, which neither reference has.
Do not carry over: the container.
ahpd is a library with an explicit port surface and no runtime dependency, and a `ctx` proxy plus a service registry is a second framework inside it.

## What ahpd already has

`createHost(options: HostOptions)` is the whole composition point and `HostOptions` is the whole contribution surface.
`agents` and `tools` are lists, every port is optional and independent, `diagnostics` and `onEvent` are already handed in, and `@ahpd/agent-claude` is proof that a backend is a package the host has never heard of.
`packages/sdk/src/types/agent.ts` imports no runtime value, so the contract is readable without loading the library.
What is missing is only that the daemon hands `createHost` the literal instead of a folded result.

## What a plugin is

A module with named exports, in the same idiom as an `Agent`.

```ts
export const name = '@ahpd/plugin-facio'
export const needs = ['store']                 // optional, phase two
export const provides = ['store']              // optional, phase two
export const defaults = { model: 'gpt-5' }     // optional
export function apply(host: PluginHost, options: Record<string, unknown>): void | Promise<void>
```

Only `name` and `apply` are required.
Named exports and no default export, deliberately: the cordis postmortem about `exports.default ?? exports` is a bug worth not having.
`apply` receives the same thing `main.ts` holds, named.

```ts
interface PluginHost {
  readonly path: string                        // the default served directory
  readonly paths: string[]                     // every served directory
  readonly version: string                     // the daemon's version
  log(line: string): void
  agent(agent: Agent): void                    // additive
  agents(list: Agent[]): void                  // additive
  tool(tool: HostTool): void                   // additive
  tools(list: HostTool[]): void                // additive
  port<K extends PortKey>(key: K, value: PortOf<K>): void   // singleton keys
  hook<E extends keyof Hooks>(event: E, fn: Hooks[E]): void // phase two
  service<T>(name: string, value: T): void     // phase two
  use<T>(name: string): T                      // phase two
}
```

`PortKey` is exactly the singleton half of `HostOptions`: `resources`, `terminals`, `changes`, `directories`, `worktrees`, `github`, `automations`, `sessions`, `diagnostics`.
Nothing here is a new concept to learn, because the surface is the option object that already exists.
`needs` and `provides` are the one addition with no precedent in ahpd, and they are what lets a harness name a store package instead of importing it.
Their ordering rule is the one facio already uses in `packages/commands/src/registry.ts`: resolve by dependency, refuse a missing one at startup, refuse a cycle by name.

## How a plugin is added

Three ways in, narrowest last.

Install it where the daemon can resolve it, which is the config directory:

```bash
cd ~/.config/ahpd && npm i @ahpd/plugin-facio
```

Name it in `config.json` beside `port` and `paths`:

```json
{
  "plugins": [
    "@ahpd/plugin-facio",
    { "name": "@ahpd/plugin-openai", "options": { "baseUrl": "http://127.0.0.1:11434/v1" } },
    { "name": "./scratch/thing.js", "enabled": false }
  ]
}
```

Or name it for one run only:

```bash
ahpd --plugin @ahpd/plugin-facio --plugin ./scratch/thing.js
ahpd --no-plugins
```

Resolution is per spec shape.
A bare name resolves through `createRequire(join(configDir(), 'package.json'))` and is then imported by file URL, which was checked against the file in `agents-as-extensions.md` and verified.
A `./` or absolute spec resolves against the working directory and then against the config directory, so a checkout can be pointed at without publishing anything.
`file:`, `npm:`, `jsr:` and `https:` are passed to the runtime untouched, because a URL is already a decision.
A bare name on Deno is the one case that does not work, since Deno has no `createRequire`, so Deno wants `npm:` written out.
Saying that is better than a resolver that half works on one of the three runtimes.

`enabled: false` and `--no-plugins` are worth having from the first cut, because the way to find out whether a plugin caused something is to start without it.

## Loading, and what a bad plugin costs

The loader lives in `@ahpd/server`, because it reads files, imports and knows the config file, and `main.ts` already owns all three.
The contract types and the pure fold live in a new `@ahpd/plugin`, so an author depends on types alone and an embedder can reuse the fold without the daemon.

The order is: read the config, expand the specs, resolve each to a URL, `import` each, check the shape, `apply` each in order, fold every contribution into one `HostOptions`, `createHost`, `listen`.
`main.ts` then shrinks to its own ports as the base layer, one call into the loader, and the two calls it already ends with.

A spec that does not resolve, a module that throws on import and an `apply` that throws are each reported on stdout and skipped.
One bad plugin should not take the daemon down, and the daemon has a log to say which one it was.
A `provider` collision is the exception and refuses at startup, naming both plugins.
`provider` is the routing key a client names in `createSession`, so a collision is a turn delivered to the wrong backend with nothing on screen to say so.

## When two plugins want the same thing

`agents` and `tools` concatenate, since a host with two backends is the case the list was written for.
A singleton port claimed by two plugins is an error naming both, unless the later one asked for `{ replace: true }` on that key.
The daemon's own ports are the base layer under every plugin, so a plugin that wants `fileResources()` gone says so rather than winning by order.
A plugin added after another can build on it without replacing it by taking the value it was given, which is what makes a wrapping resources store or a chained changeset source ordinary rather than a special case.
Composition helpers for the ports that can honestly merge are their own later piece; the first cut is concatenate or refuse, and refusing loudly is the ahpd answer.

## Options and config

A plugin declares `defaults`, the daemon merges `plugins[i].options` over them and hands the result to `apply`.
No host-side schema validator is added for this.
ahpd has no runtime dependency and `Agent.schema()` already settled that validation is the thing's own business, so a plugin that wants to refuse a bad option exports its own `resolve(options)` and does it before `apply`.

Two other things called config are not the same thing.
Session config is already extensible, because it is composed from the invited backend's `schema()` plus the host-owned keys, so a plugin that contributes an agent gets its controls for free and needs nothing new.
Root config is not: `ROOT_CONFIG_SCHEMA` inside `host.ts` is a fixed literal with `defaultShell` in it.
A plugin that adds a root key wants that schema to become a `HostOptions` field merged the same way session config is, rather than a plugin reaching into the host to write one.

## Hooks on sessions

Three ways, and the first two need no change to `@ahpd/sdk`.

A plugin is a client.
`createPeer(wire)` plus `receive` builds an in-process peer and `host.accept(peer)` serves it, so a hook that watches turns subscribes to a session or chat channel exactly as `ahpc` does, sees every state action the protocol already carries, and can dispatch one back.
That is the most ahpd-shaped hook there is: the protocol is the API, and the host was built for several clients all along.

A plugin wraps what it contributes.
A contributed `HostTool` decides before it runs, which is a permission gate with no new mechanism.
A contributed port can delegate to the one beneath it.
A plugin that wraps `accept` sees every frame in both directions, which is enough for a log, a rate limit or a redaction.

What none of those reach is the host's own bookkeeping: the read and archived flags, config resolution, a store write, and the closing of a session nobody opened.
Those want a typed `hooks` option on `HostOptions` and one call at the sites that already call `log()`, which is about fifty lines and no new file.
Proposed names: `sessionOpened`, `sessionDisposed`, `turnStarted`, `turnCompleted`, `clientConnected`, `clientGone`, `authenticated`, `automationFired`, `resourceWritten`, `terminalOpened`.
Observation first.
A hook that may refuse a turn is a second decision, and the permission case is already covered by the tool wrapper above.

## Versioning

No runtime `apiVersion`, because neither reference has one and both are right not to.
A plugin declares `peerDependencies: { "@ahpd/sdk": "^0.6" }`, and the contract is the exported types.
`@ahpd/plugin` existing as its own package is what gives those types one name and one version to point a range at.
A plugin pinned to an old `@ahpd/sdk` fails to install rather than failing at a call site, which is the failure worth having.

## The first plugin, which is facio

`@ahpd/plugin-facio` is an `Agent` over `@facio/agents`, and it is the case that stresses the design.
`provider: 'facio'`, `schema()` from the agent's own parameters, `probe()` from its models and tools, and `create(start)` mapping `run()`'s `RunEvent`s onto the `chat/*` actions `@ahpd/agent-claude` already shows how to emit.
A `policy.decide` answering `ask` becomes `session/inputNeededSet` plus `confirm`, `resume()` re-attaches a paused run, and `transcript()` reads a `Store`.
It wants `needs`/`provides` because the durable store is `@facio/store-file`, a package of its own, and a harness that names it is more honest than one that imports it and forbids a second store.

## Not here

No DI container, no `ctx` proxy, no `jiti`: a plugin is one function and the types it already knows, and loading TypeScript directly stays a dev affordance rather than the mechanism.
No hot reload in the first cut: a changed plugin module needs a restart, the same as a changed daemon, and pretending otherwise is how a half-loaded plugin becomes a bug report.
No sandbox, because there cannot be one: a plugin is code in the daemon's process with the daemon's permissions, so installing one is the trust decision and the config file is owner-readable for the same reason the token file is.
No plan yet.
This file is the shape; `agents-as-extensions.md` is still the order for the agent half, and the port and hook halves want their own plan once the first two steps land.
