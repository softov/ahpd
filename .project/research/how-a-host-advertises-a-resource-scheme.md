---
title: How a host advertises a resource scheme, and what a client can draw from it
date: 2026-09-23
refs:
  - "[file:///github/externals/agent-host-protocol/types/common/commands.ts#L234-L295](file:///github/externals/agent-host-protocol/types/common/commands.ts#L234-L295) - `InitializeResult`, the typed host capabilities"
  - "[file:///github/externals/agent-host-protocol/types/channels-root/state.ts#L36-L51](file:///github/externals/agent-host-protocol/types/channels-root/state.ts#L36-L51) - `RootState`, whose only extension point is `_meta`"
  - "[file:///github/externals/agent-host-protocol/types/common/errors.ts#L41-L90](file:///github/externals/agent-host-protocol/types/common/errors.ts#L41-L90) - `-32008` NotFound and `-32009` PermissionDenied, in the protocol's own words"
  - "[file:///github/externals/agent-host-protocol/types/channels-session/state.ts#L1252-L1257](file:///github/externals/agent-host-protocol/types/channels-session/state.ts#L1252-L1257) - the `Customization` union, which is closed"
  - "[code://packages/sdk/src/host.ts#L4779](../../packages/sdk/src/host.ts#L4779) - where ahpd advertises `automations` only when it holds the store"
  - "[code://packages/sdk/src/resources.ts#L52-L58](../../packages/sdk/src/resources.ts#L52-L58) - `why`, the file store's answer for a URI another scheme was meant to serve"
  - "[code://packages/sdk/src/host.ts#L4604-L4608](../../packages/sdk/src/host.ts#L4604-L4608) - `storeFor`, which falls back to the file store for an unknown scheme"
  - "[file:///github/externals/vscode/src/vs/sessions/services/sessions/common/session.ts#L294-L302](file:///github/externals/vscode/src/vs/sessions/services/sessions/common/session.ts#L294-L302) - `SessionCustomizationKind`, a seven-value closed enum"
  - "[file:///github/externals/vscode/src/vs/sessions/contrib/chat/browser/sessionCustomizations.ts#L46-L54](file:///github/externals/vscode/src/vs/sessions/contrib/chat/browser/sessionCustomizations.ts#L46-L54) - the fixed section order"
  - "[file:///github/externals/vscode/src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionCustomizations.ts#L188-L194](file:///github/externals/vscode/src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionCustomizations.ts#L188-L194) - the fixed `CustomizationType` to kind table"
  - "[code://packages/computer/src/provider.ts](../../packages/computer/src/provider.ts) - the `computer:` provider a client would browse"
  - "[code://.project/research/a-computer-three-things.md](../../.project/research/a-computer-three-things.md) - what the computer route is"
---

# How a host advertises a resource scheme

Written 2026-09-23 for the question a client asks: how do I know this host has computers, before any machine exists?

## What AHP has

A host capability is a **typed field on `InitializeResult` whose presence means support**. The ones defined are `_meta`, `completionTriggerCharacters`, `terminalCommandPrefix`, `telemetry` and `automations`.
`automations` is the precedent and the one a person sees on screen: its doc says "Presence means clients may subscribe to `ahp-automations://` ... absence means the host does not expose an automation catalogue or automation commands", and ahpd sets it exactly that way - `...(options.automations ? { automations: { create: {}, schedules: {} } } : {})`.

So the Automations window is not the agent and not a UI whim: the host advertised the capability and the client drew what the capability describes.
That is the shape a computer should have, and it is why "was it supposed to be a capability" has the answer **yes, in that sense**.

There is no typed field for a resource scheme. `RootState` has `agents`, `activeSessions`, `terminals`, `config` and `_meta`, and its `_meta` is the documented escape hatch: "Additional implementation-defined metadata about the agent host itself. Clients MAY look for well-known keys here to provide enhanced UI."
`InitializeResult._meta` says the same, with a warning: "Capabilities needed for interoperable behavior SHOULD use typed fields on `InitializeResult` instead."

## Why a typed field is a protocol change

Both sides compile against the same closed types: ahpd imports `@microsoft/agent-host-protocol` and VS Code vendors it (`src/vs/platform/agentHost/common/state/protocol/`).
A field ahpd writes but the client's copy does not declare is dropped by a strict reader, and a field VS Code reads but no host sends is dead code. So a typed `resourceSchemes` needs a change in the protocol repository first and a client change after, in that order. That is the PR the user does not want to depend on.
`_meta` needs neither, because it is `Record<string, unknown>` by design and both sides already pass it through.

## The discovery a client has today

`resourceList('computer://')` with the plugin loaded answers the machines, or `[]` when there are none.
Without the plugin the request reaches `storeFor`, which falls back to the file store for a scheme no provider owns, and the file store answers `-32009` with "nothing here serves computer:, and no connected client publishes it".

That code is wrong for the situation. The protocol says `-32008` is "the requested file, folder, or URI does not exist" and `-32009` is "the client is not permitted to access the requested resource". Nothing here is a permission question: the host has no provider for the scheme, which is the same kind of answer as a provider that lacks a method, and that one is already `-32601`.
So a client can only tell "no computers here" by reading prose today, which is exactly what a capability is for.

## What VS Code can draw, and what it cannot

The Agent Customizations window is a closed set.
`SessionCustomizationKind` has seven values - agent, skill, instruction, hook, prompt, mcpServer, plugin - the dropdown's sections are a fixed array in that order, and the Agent Host mapping table maps exactly seven AHP `CustomizationType` values onto them.
AHP's `Customization` union is closed too: plugin, directory, mcpServer, with six child kinds.
There is no extension prefix for a customization type. The `x-` prefix the overview reserves covers channel URI schemes, command methods, notification methods and action types, not customization types.

So a "Computers" section in that window needs a new AHP customization type **and** a new VS Code section. It is not reachable from a plugin, and `_meta` cannot make it appear because VS Code's UI reads `_meta` only for known `vscode.*` keys.
What a client can do with computers today is browse the scheme through a resource UI it already has, and ahpapp - which reads `initialize._meta` and draws its own screens - is the one that can gain a Computers screen without either upstream change.

## Options

1. **Advertise in `initialize._meta` under `ahpd.resourceProviders`** (recommended for now), with a per-provider description: title, actions, and the manifest a create body takes. ahpapp reads `HostInfo.meta` and draws the screen; a client that does not know the key shows nothing, which the spec allows.
2. **A typed `InitializeResult.resourceSchemes` upstream**, which is where this belongs once it is interoperable. Not now, and not depended on.
3. **Probe only**, treating the error as absence. Cheapest, and feature detection by prose, which the protocol's guidance argues against.
4. **Per-session inference** from the `computer` schema key or the tools. Rejected by the user: it needs a session first and the tools are off by default.

Alongside whichever is chosen, one small correction: an unregistered scheme should answer a code a client can branch on, not `-32009` with a sentence. `-32601` is the host's own answer for an operation it does not serve, and `-32008` is the protocol's "no such URI"; either is honest, and `-32009` should stay for a person's role refusing a command.

## What ahpapp would do

- On connect, read `initialize._meta`; if `ahpd.resourceProviders.computer` is there, the host has computers.
- List with `resourceList('computer://')`, read `computer://<id>/status` for one, create with `resourceWrite` to `computer://<name>` and `createOnly`, destroy with `resourceDelete`.
- Draw Create always and let a `-32009` open the permission sheet it already has, or hide it when the person cannot write - which the client cannot know before trying.
- For a host that advertises nothing, fall back to probing `resourceList('computer://')` and treat a `-32601`/`-32008` as absent.

## The host side, if option 1 is chosen

A resource provider should describe itself rather than `host.ts` naming `computer`: an optional `describe()` on `ResourceProvider`, or a plugin-contributed root key, with the host merging every registered provider's description into `initialize._meta` and `RootState._meta`.
`computerProvider` answers with its title, its actions and its manifest fields, which are the same facts `computer://<id>/capabilities` already reports for one machine.
