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

| Kind | `PluginHost` method | Lands in | Status |
| --- | --- | --- | --- |
| agent | `agent()`, `agents()` | `HostOptions.agents`, the backend a client names in `createSession` | this plan |
| tool | `tool()`, `tools()` | `HostOptions.tools`, the server tools offered to every session's model | this plan |
| port | `port(key, value, when?)` | the nine singleton `HostOptions` keys: `resources`, `terminals`, `changes`, `directories`, `worktrees`, `github`, `automations`, `sessions`, `diagnostics` | this plan |
| customization | `customization()` | a new `HostOptions.customizations`, merged into every session and into an agent's `probe()`, which is where skills, prompts, rules and hook data live | next plan |
| MCP server | `mcpServer()` | a customization of type `mcpServer`, and `Start.mcpServers`, which `SessionOptions` already carries | next plan |
| hook | `hook(event, fn)` | a new `HostOptions.hooks`, called where the host already logs | later |
| configuration key | `config(key, schema, default)` | a new `HostOptions.rootConfig`, beside the session keys an agent already declares | later |
| host method | `method(name, handler)` | an extension table beside the request handlers, and a channel beside the declared ones | later, and its protocol half is [a proposal](../../proposals/agent-host-protocol-extension-methods.md) |
| log sink | `onEvent(fn)` | `HostOptions.onEvent`, which becomes additive rather than a single function | later |

Four things are deliberately not kinds, so that a plugin does not look for a method that should not exist.
Models are not, because each agent reports its own through `probe()`.
Slash commands are not separate from customizations, because `Offered.commands` is already one projection of them.
UI is not, because a client owns its own screen and the host serves it resources.
HTTP routes are not, because there is no HTTP server.
`port` is the only method that takes a key, and the key is the written-out `PortKey` union rather than a `string`, so it is one generic method over the nine ports and not a way to register a tenth thing the table does not have.

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
- No hook reaches a running host, and the first plan deliberately leaves that to the protocol: a plugin that wants events is a client.
