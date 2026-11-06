---
title: Plugin - what exists today
domain: plugin
revalidated: 2026-10-21
---

A plugin is an installed package the daemon folds into the options it hands `createHost`, so a backend, a port, a tool or a configuration key is an install and a configuration line rather than a rebuild.
Plan [01 - Plugins load from configuration](01-plugins-load-from-configuration/plan.md) built the loader and the first three kinds: the contract and the fold live in `@ahpd/sdk`, the resolving, importing and applying half is `packages/server/src/plugins.ts`, and a daemon with plugins serves what they contributed.
Plan [02 - Plugins subscribe to the host's own events](02-plugins-subscribe-to-host-events/plan.md) built `on` and the thirteen events a handler observes.
Every kind after those waits, and the whole list is in [deferred.md](01-plugins-load-from-configuration/deferred.md).

## Glossary

- **Front** - the chat where a person and a bot talk. The bot-chat provider serves it, with no model.
- **Back** - a chat where a harness does a bot's work and replies to the Front with `post_message`.
- **Manifest** - what a plugin declares before it runs: a description, categories, links and contracts.
- **Contract** - the list of names a plugin registers for one kind, such as its channels.
- **Adapter** - an integration a plugin registers, with a configuration schema and capabilities.
- **Connector** - one configured account of an adapter, owned by the host, a team or a person.
- **Capability** - a typed entry that says what an adapter does, such as `receive` or `command`.

## Packages

- `code://packages/sdk` - `createHost` and `HostOptions`, the composition point a plugin contributes to; `types/agent.ts` is the `Agent` contract a harness plugin implements.
- `code://packages/server` - the daemon: its configuration file, its command line, and the literal a plan in this domain replaces with a folded result.
- `code://packages/agent-claude`, `code://packages/agent-cofold` and `code://packages/agent-acp` - the backends that ship, and the worked examples of a package the host knows nothing about: one over a harness library, one over a protocol, and one over a protocol spoken to a subprocess.
- `code://packages/computer` - the first package to serve a host-owned URI scheme, so the resource-provider kind has a consumer that is not a test fixture.

A plugin package from this repository is `@ahpd/<name>`, and an agent backend is `@ahpd/agent-<name>` ([decision](../../../docs/plugins/PLUGINS.md)).
Its id is the `<name>` without the scope, a slug, as [plan 51](51-a-plugin-id-is-a-slug/plan.md) says: `@ahpd/bot` is the plugin `bot`.

## Contracts

- `code://packages/sdk/src/types/host.ts#L132-L245` - `HostOptions`, the whole contribution surface: `agents`, `tools`, and the ports `resources`, `terminals`, `changes`, `directories`, `worktrees`, `github`, `automations` and `sessions`.
- `code://packages/sdk/src/types/host.ts#L279-L332` - `HostTool`, what a plugin contributes to every session's model.
- `code://packages/sdk/src/types/agent.ts#L158-L300` - `Agent`, what a harness plugin implements, and `types/session.ts#L160` for the `Session` it returns.
- `code://.project/plans/plugin/01-plugins-load-from-configuration/plan.md` - what a plugin is allowed to contribute and what it is not.
- `code://docs/plugins/PLUGINS.md` - where a plugin declares its entry and its title.
- `code://.project/plans/plugin/01-plugins-load-from-configuration/plan.md` - where the contract lives, and why it is not a package of its own.
- `code://docs/plugins/PLUGINS.md` - why the set below is closed and one method per kind.

## Registration kinds

The whole of what a plugin may register, one method each, and the plan each kind belongs to.
This is the list [A plugin registers from a closed set of kinds, one register method each, and every registration is checked](../../../docs/plugins/PLUGINS.md) closes; nothing registers anything that is not a row here.

| Kind | `PluginHost` method | Operation | Lands in | Status |
| --- | --- | --- | --- | --- |
| agent | `registerAgent(agent)` | append | `HostOptions.agents`, the backend a client names in `createSession`; a reserved name, or a name a scheme holds, is refused | built 2026-09-20, reserved names [plan 42](42-a-reserved-name-is-refused/plan.md) |
| tool | `registerTool(tool)` | append | `HostOptions.tools`, the server tools offered to every session's model | built 2026-09-20 |
| port | `registerResources(store)`, `registerTerminals(store)`, `registerChanges(source)`, `registerDirectories(facts)`, `registerWorktrees(worktrees)`, `registerGithub(pullRequests)`, `registerAutomations(store)`, `registerSessions(store)`, `registerDiagnostics(diagnostics)`, `registerRecords(store)` | set, closed key | the ten singleton `HostOptions` keys: `resources`, `terminals`, `changes`, `directories`, `worktrees`, `github`, `automations`, `sessions`, `diagnostics`, `records`; a plugin opens a collection of `records` with `host.records(name)` | built 2026-09-20, `records` [plan 45 p1](45-p1-the-host-gives-a-record-store/plan.md) |
| resource provider | `registerResourceProvider(scheme, provider)` | register, open key | `HostOptions.resourceProviders`, one provider per host-owned URI scheme, routed beside the `file:` store; a reserved name, or a name a harness holds, is refused | built 2026-09-22, reserved names [plan 42](42-a-reserved-name-is-refused/plan.md) |
| customization | `registerCustomization(customization)` | append | a new `HostOptions.customizations`, merged into every session and into an agent's `probe()`, which is where skills, prompts, rules and hook data live | not planned yet |
| MCP server | `registerMcpServer(server)` | append | a customization of type `mcpServer`, and `Start.mcpServers`, which `SessionOptions` already carries | not planned yet |
| event | `on(event, handler)` | listen | a new `HostOptions.events`, called at the moments the host already knows | built 2026-09-20 |
| HTTP route | `registerRoute(handler)` | register, open key | a handler the daemon's own listener serves under `/plugins/<name>/`, beside the HTTP API and beside a session's tools servers; it lands in the fold's `routes`, keyed by plugin name, rather than in `HostOptions` | built 2026-10-04, [plan 21](21-a-plugin-serves-an-http-route/plan.md) |
| provider configuration | `registerProviderConfiguration(registration)` | register, open key | `HostOptions.providerConfigurations`, one per provider: its properties are root config keys at the top of the schema with their defaults filled, and its title, description and settings are listed in root state's `_meta['vscode.agentCustomizationSettings']`, as VS Code registers a provider's configuration; a key another configuration declares is reported, and one the host's own schema declares stays the host's | built 2026-11-06, the audit's hooks brief |
| channel | `registerChannel(scheme, channel)` | register, open key | `HostOptions.channels`, one channel per `x-` scheme, which a client subscribes to and the plugin publishes on, with a test of who sees each action | built 2026-10-10, [plan 44](44-a-plugin-serves-a-channel/plan.md) |
| adapter | `registerAdapter(adapter)` | register, open key | `HostOptions.adapters`, one adapter per name, with the schema a client draws a connector's form from and the capabilities it lists; a name another plugin registered is reported and that plugin loses the adapter alone | built 2026-10-21, [plan 53](53-a-client-sees-plugins-and-connectors/plan.md) |
| host method | `registerMethod(name, method)` | register, open key | `HostOptions.methods`, one command per `x-` name, which a client sends after the gate asks for its grant, and which the host lists in `_meta['ahpd.methods']` | built 2026-10-11, [plan host/81 p1](../host/81-p1-the-host-serves-x-commands/plan.md); its protocol half is [a proposal](../../proposals/agent-host-protocol-extension-methods.md) |

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

Three things are deliberately not kinds, so that a plugin does not look for a method that should not exist.
Models are not, because each agent reports its own through `probe()`.
Slash commands are not separate from customizations, because `Offered.commands` is already one projection of them.
UI is not, because a client owns its own screen and the host serves it resources.

## Runtime path

```
ahpd [flags] -> main.ts parses config.json under the flags -> createHost(literal) -> listen()
                                                                  ^
                                            the seam every plan in this domain inserts at
```

## Tests

- `code://test/example.test.ts#L1-L30` - the fake-peer pattern an end-to-end plugin test follows.
- `code://test/host-*.test.ts` - the host as the daemon builds it, which is what a plugin-contributed backend is expected to pass through unchanged.

## Known gaps

- Customizations, MCP servers, hooks-as-data, a plugin configuration key, `needs` and `provides`, an installer, hot reload and reading the port beneath all wait on an SDK option or a later plan; the whole list is [deferred.md](01-plugins-load-from-configuration/deferred.md).
- [03 - An agent backend over cofold](03-agent-cofold/plan.md) is built: `@ahpd/agent-cofold` is the first real consumer of this mechanism, one installed package that runs a harness and serves every model it can reach, and it is also the worked example in [docs/plugins/PLUGINS.md](../../../docs/plugins/PLUGINS.md).
- [04 - The cofold extras](04-agent-cofold-extras/plan.md) is built: a host tool says what running it does, a cofold conversation forks and rewinds, and a tool a client runs is offered and waited for.
- [07 - The ACP bridge](07-agent-acp/plan.md) is built: `@ahpd/agent-acp` speaks the Agent Client Protocol to any server, so `copilot --acp`, `codex-acp`, `gemini --experimental-acp` and `@deepseek-ai/dsh-acp` are configuration lines, and the file, shell and permission requests a server makes back are answered through the host's own ports; the decision [agent-package-only-when-it-brings-a-runtime](../../decisions/agent-package-only-when-it-brings-a-runtime.md) is why a model or an endpoint is not a package of its own.
- [53 - A client sees the plugins and the connectors](53-a-client-sees-plugins-and-connectors/plan.md) is implemented: a plugin declares a manifest, and every registration is checked against its contracts.
  The `x-ahpd-plugins` and `x-ahpd-connectors` channels show a client the plugins and the connectors.
  The ahpw pages and the UI component tree wait on later plans.
- The next plans, in order:
  1. [17 - A plugin hears when a session needs a person](17-a-plugin-hears-a-session-needs-a-person/plan.md) adds `input_needed_set` and `input_needed_removed`.
  2. [20 - A plugin is a client of its own host, as a principal of its own](20-a-plugin-is-a-client-of-its-own-host/plan.md) lets a plugin start sessions, send turns and run automations as `plugin:<name>`.
  3. [21 - A plugin serves an HTTP route on the daemon's listener](21-a-plugin-serves-an-http-route/plan.md) adds `registerRoute`, after daemon 05 tasks 15 and 16.
  4. [18 - The ACP bridge resumes, forks and asks](18-the-acp-bridge-resumes-forks-and-asks/plan.md) adds `session/resume`, `session/fork` and `elicitation/create`; ACP v2 waits in its [deferred.md](18-the-acp-bridge-resumes-forks-and-asks/deferred.md).
  5. [19 - A docker machine may run under gVisor](19-a-docker-machine-may-run-under-gvisor/plan.md) adds `ociRuntime`; `ssh`, `libvirt` and `proxmox` are container 05 p9 and p8, and the rest is an [idea](../../ideas/more-computer-runtimes.md).
