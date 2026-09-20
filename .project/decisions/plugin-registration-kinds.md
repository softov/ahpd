---
title: A plugin registers from a closed set of kinds, one register method each, and every registration is checked
status: accepted
date: 2026-09-20
refs:
  - code://.project/plans/plugin/00-plugin.md - where the closed set is listed
  - code://.project/decisions/plugin-contributes-host-options.md - the surface these methods are on
  - file:///github/doop/packages/sdk/src/plugin.ts#L41-L186 - `PluginApi`, one `register*` per capability
  - file:///github/doop/packages/sdk/src/plugin-asserts.ts - the shape assertions doop runs on what a plugin registers
  - file:///github/doop/plugins/STRUCTURE.md - the "Registration Targets" table
  - code://.project/proposals/agent-host-protocol-extension-methods.md - the protocol half of a plugin-served method
---

## Context

The plugin system is being written now, so whether a registration is checked is a decision to make rather than a property to inherit.
There is no other place a value the daemon did not write enters `HostOptions`: the daemon writes every port it passes, and a plugin is the first thing that does not.
TypeScript does not survive to runtime and a plugin may be JavaScript, so a type signature is what an author reads and not what the daemon can rely on.
The contracts a registration has to satisfy are already written down, member by member, as `Agent`, `HostTool`, `ResourceStore`, `TerminalStore`, `ChangesetSource`, `DirectoryFacts`, `Worktrees`, `PullRequests`, `AutomationStore` and `SessionStore`.
Checking a value against one of them is a `typeof` test per required member, which is a few lines and no dependency.

doop reaches the same conclusion: `plugin-asserts.ts` exists beside its `PluginApi`, and its loader marks a plugin `error` rather than registering a shape it cannot use.
It also names every registration method `register*`, which is what tells a registration apart from the host a plugin reads from.

## Decision

A plugin registers from a closed set of kinds, one method each, and every method that contributes a value is named `register*` so that a registration is told apart from the host a plugin reads. The one subscription, `on`, is named for what every event emitter calls it.
The list is kept in `plans/plugin/00-plugin.md` and repeated here in short: agent, tool, port, customization, MCP server, event, configuration key, and host method.
The first plan implements the first three: `registerAgent`, `registerTool`, and one method for each of the nine ports, `registerResources`, `registerTerminals`, `registerChanges`, `registerDirectories`, `registerWorktrees`, `registerGithub`, `registerAutomations`, `registerSessions` and `registerDiagnostics`.
Every other kind is named in the domain reference with the plan it belongs to, so a plugin author sees the whole surface from the first release and knows what is not there yet.

Every `register*` checks what it is given before it records it.
The check is structural and hand-written: each required member the contract names has to be there and be the right kind of thing, and optional members that are present have to be the right kind too.
A failed check throws a message naming the plugin, the method and the member that failed, and the loader's existing try around `apply` reports it and discards that plugin's whole contribution.
An open-ended `contribute(name, value)` bag is rejected: it cannot be checked at the call site and it cannot be listed.

Methods group by operation rather than by kind.
`append` adds an entry to a list, which is `registerAgent`, `registerTool` and later `registerCustomization`.
`set` installs the single value for a key, which is the nine ports, and it is why one conflict rule and one `replace` word serve all of them instead of nine copies.
`listen` attaches a listener to an event the host already fires, which is `on`, and it is the one operation that adds nothing to `HostOptions`.
An open key is registered under a name the plugin invents, which is `registerConfig` and `registerMethod`, and its keys cannot be a written union the way the ports' keys can.
A key belongs to exactly one operation, and the internal `PortKey` union is the closed set of `set` keys, so it excludes `agents`, `tools` and every appended kind and there is no second way to reach one.

## Consequences

"What can a plugin register" has one answer in one place, and a new kind is a new row plus a new method rather than a discovery.
The check lives at the plugin boundary because that is where a value the daemon did not write enters; `createHost` keeps trusting its caller, which is the daemon and not a package somebody installed.
A JavaScript plugin and a TypeScript one are checked the same way, because the type is gone by the time either runs.
A plugin that throws out of a registration loses its whole contribution rather than keeping the part that was registered before the bad one, so the host never holds half of a plugin.

The checkers are hand-written, so one can miss a member a later change to an interface adds.
The test pairs each checker with a complete implementation and with an empty object, so a member added to `Agent` or `SessionStore` and not to its checker fails a test rather than reaching a host.
Eleven registration methods are more surface than three, and the cost of naming each port is that the shared conflict rule and the `replace` word live in one private helper behind nine one-line methods rather than in a single method.

## Options

- **An open bag**, `contribute(name: string, value: unknown)`.
  Rejected: it moves every mistake to runtime, makes autocomplete useless, and a listing has nothing to enumerate.
- **One `registerPort(key, value, when?)` over the closure of ports**, with named methods only for the other kinds.
  Rejected: it is the only keyed method in a contract that otherwise names what it does, and a reader has to know `PortKey` to discover the ports rather than reading nine names off the host.
- **Types only, with no runtime check.**
  Rejected: types do not exist at runtime, a plugin may be JavaScript, and a value written by `apply` is the one thing in `HostOptions` that the daemon did not write itself.
- **A JSON Schema validator as a dependency.**
  Rejected: ahpd has no runtime dependency, the contracts are TypeScript interfaces rather than schemas, and the check is a `typeof` per required member.
