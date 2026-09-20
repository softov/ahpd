---
title: Plugin - what exists today
domain: plugin
revalidated: 2026-09-20
---

A plugin is an installed package the daemon folds into the options it hands `createHost`, so a backend, a port, a tool or a configuration key is an install and a configuration line rather than a rebuild.
Nothing of this domain exists yet: `main.ts` names its one backend and every port in a literal, and `@ahpd/sdk` declares no plugin contract.
What exists is everything the mechanism is built on, and it is all in `@ahpd/sdk`.

## Packages

- `code://packages/sdk` - `createHost` and `HostOptions`, the composition point a plugin contributes to; `types/agent.ts` is the `Agent` contract a harness plugin implements.
- `code://packages/server` - the daemon: its configuration file, its command line, and the literal a plan in this domain replaces with a folded result.
- `code://packages/agent-claude` - the one backend that ships, and the worked example of a package the host knows nothing about.

## Contracts

- `code://packages/sdk/src/types/host.ts#L132-L245` - `HostOptions`, the whole contribution surface: `agents`, `tools`, and the ports `resources`, `terminals`, `changes`, `directories`, `worktrees`, `github`, `automations` and `sessions`.
- `code://packages/sdk/src/types/host.ts#L270-L306` - `HostTool`, what a plugin contributes to every session's model.
- `code://packages/sdk/src/types/agent.ts#L158-L292` - `Agent`, what a harness plugin implements, and `types/session.ts#L160` for the `Session` it returns.
- `code://.project/decisions/plugin-contributes-host-options.md` - what a plugin is allowed to contribute and what it is not.
- `code://.project/decisions/plugin-manifest-is-package-json.md` - where a plugin declares its entry and its title.
- `code://.project/decisions/plugin-contract-lives-in-the-sdk.md` - where the contract lives, and why it is not a package of its own.
- `code://.project/decisions/plugin-registration-kinds.md` - why the set below is closed and one method per kind.

## Registration kinds

The whole of what a plugin may register, one method each, and the plan each kind belongs to.
This is the list decision [plugin-registration-kinds](../../decisions/plugin-registration-kinds.md) closes; nothing registers anything that is not a row here.

| Kind | `PluginHost` method | Operation | Lands in | Status |
| --- | --- | --- | --- | --- |
| agent | `registerAgent(agent)` | append | `HostOptions.agents`, the backend a client names in `createSession` | this plan |
| tool | `registerTool(tool)` | append | `HostOptions.tools`, the server tools offered to every session's model | this plan |
| port | `registerResources(store)`, `registerTerminals(store)`, `registerChanges(source)`, `registerDirectories(facts)`, `registerWorktrees(worktrees)`, `registerGithub(pullRequests)`, `registerAutomations(store)`, `registerSessions(store)`, `registerDiagnostics(diagnostics)` | set, closed key | the nine singleton `HostOptions` keys: `resources`, `terminals`, `changes`, `directories`, `worktrees`, `github`, `automations`, `sessions`, `diagnostics` | this plan |
| customization | `registerCustomization(customization)` | append | a new `HostOptions.customizations`, merged into every session and into an agent's `probe()`, which is where skills, prompts, rules and hook data live | not planned yet |
| MCP server | `registerMcpServer(server)` | append | a customization of type `mcpServer`, and `Start.mcpServers`, which `SessionOptions` already carries | not planned yet |
| event | `on(event, handler)` | listen | a new `HostOptions.events`, called at the moments the host already logs | [plan 02](02-plugins-subscribe-to-host-events/plan.md) |
| configuration key | `registerConfig(key, schema, default)` | register, open key | a new `HostOptions.rootConfig`, beside the session keys an agent already declares | not planned yet |
| host method | `registerMethod(name, handler)` | register, open key | an extension table beside the request handlers, and a channel beside the declared ones | not planned yet, and its protocol half is [a proposal](../../proposals/agent-host-protocol-extension-methods.md) |

Every method that contributes a value is named `register*`, so a registration is told apart at the call site from what a plugin only reads (`path`, `paths`, `version`, `log`). The one exception is `on`, which contributes nothing and attaches a listener to an event the host already fires; `on` is what every event emitter calls that.
Every registration is checked before it is recorded: the required members the contract names have to be there and be the right kind of thing, and a failure throws one message naming the plugin, the method and the member, which fails that plugin and never reaches `createHost`.
The check is hand-written, and the test pairs each checker with a complete implementation and with an empty object, so a member added to an interface and not to its checker fails a test rather than reaching a host.

Methods group by **operation**, not by kind, and the operation is what gives them their rules.
`append` adds one entry to a list.
`set` installs the single value for a key: the nine ports are nine names for one operation, so the conflict rule and the `replace` word are written once and shared, and each method is one line over that helper.
`listen` attaches a listener to an event the host already fires, which is never in conflict with another listener and is the one operation that is not a `register*`.
`register, open key` adds an entry under a name the plugin invents, so its keys cannot be a written union the way the ports' keys can.
A key belongs to exactly one operation, and the internal `PortKey` union is the closed set of `set` keys: it excludes `agents`, `tools` and every appended kind, so there is no second way to reach one.
If a kind ever changes operation, which is what `tools` becoming one store rather than a list would be, the old method is removed rather than left beside a second spelling of the same thing.

Four things are deliberately not kinds, so that a plugin does not look for a method that should not exist.
Models are not, because each agent reports its own through `probe()`.
Slash commands are not separate from customizations, because `Offered.commands` is already one projection of them.
UI is not, because a client owns its own screen and the host serves it resources.
HTTP routes are not, because there is no HTTP server.

## Runtime path

```
ahpd [flags] -> main.ts parses config.json under the flags -> createHost(literal) -> listen()
                                                                  ^
                                            the seam every plan in this domain inserts at
```

## Tests

- `code://test/example.test.ts#L1-L30` - the fake-peer pattern an end-to-end plugin test follows.
- `code://test/host.test.ts` - the host as the daemon builds it, which is what a plugin-contributed backend is expected to pass through unchanged.

## Known gaps

- The backend list and every port are a literal in `main.ts`; plan [01 - Plugins load from configuration](01-plugins-load-from-configuration/plan.md).
- `@ahpd/sdk` declares no plugin contract; the first task of that plan adds one to it, beside `HostOptions`.
- Nothing reads another package's `package.json`, so a plugin cannot be listed without being imported.
- No event reaches a plugin; plan [02 - Plugins subscribe to the host's own events](02-plugins-subscribe-to-host-events/plan.md) adds `on`, and a plugin that wants the live stream of a turn stays a client.
