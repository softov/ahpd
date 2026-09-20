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
