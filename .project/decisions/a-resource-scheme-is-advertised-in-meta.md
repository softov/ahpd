---
title: A resource scheme is advertised in `_meta`, and a client reads it there
status: accepted
date: 2026-09-23
refs:
  - "[file:///github/externals/agent-host-protocol/types/common/commands.ts#L234-L295](file:///github/externals/agent-host-protocol/types/common/commands.ts#L234-L295) - `InitializeResult`, whose typed host capabilities are the precedent"
  - "[file:///github/externals/agent-host-protocol/types/channels-root/state.ts#L36-L51](file:///github/externals/agent-host-protocol/types/channels-root/state.ts#L36-L51) - `RootState` and its `_meta`"
  - "[code://packages/sdk/src/host.ts#L4779](../../packages/sdk/src/host.ts#L4779) - where ahpd advertises `automations` by presence"
  - "[code://packages/sdk/src/types/resources.ts#L204-L211](../../packages/sdk/src/types/resources.ts#L204-L211) - `ResourceProvider`, which would gain `describe`"
  - "[code://packages/computer/src/provider.ts](../../packages/computer/src/provider.ts) - the worked example: what a computer can do and what a create body takes"
  - "[code://.project/research/how-a-host-advertises-a-resource-scheme.md](../../.project/research/how-a-host-advertises-a-resource-scheme.md) - the reading this settles"
---

## Context

A host can serve a URI scheme beside `file:` - `computer:` today - and nothing tells a client it is there.
The provider is reached only by asking a URI under its scheme, and the answer for an unregistered one is a permission error with a sentence, so a client learns the scheme exists by trying and reading prose.

AHP's own model for this is a **typed field on `InitializeResult` whose presence means support**: `automations`, `telemetry`, `terminalCommandPrefix`, `completionTriggerCharacters`.
`automations` is exactly the shape wanted here - "Presence means clients may subscribe to `ahp-automations://` ... absence means the host does not expose an automation catalogue" - and ahpd sets it only when it holds the store.
But there is no typed field for a resource scheme, and the protocol says what to do about that: `_meta` is "implementation-specific extension metadata advertised by the host", clients MAY look for well-known keys "to provide enhanced UI", and capabilities needed for *interoperable* behaviour SHOULD use typed fields instead.

A typed field is not available to this repository.
Both sides compile against the same closed types - ahpd imports `@microsoft/agent-host-protocol`, the reference client vendors a copy - so a field ahpd invents is dropped by a strict client and a field a client reads has to exist upstream first.
That is a change in the protocol repository and then in every client, in that order, and this repository does not depend on one.

What a client needs to know is what the scheme is called, what it can be asked to do, and what a create body may contain before any machine exists, because `computer://<id>/capabilities` needs a machine to read.

## Decision

A host advertises every scheme it serves in `_meta['ahpd.resourceProviders']`, on both `initialize._meta` and `RootState._meta`, from one function so the two cannot disagree.
The map is keyed by scheme, and each entry is the provider's own description merged with what the host can see for itself:

- `title` and `description` from the provider,
- `root`, the scheme with `://`,
- `operations`, derived by the host from the methods the provider implements - `read`, `list`, `resolve`, `write` and `delete` - so a scheme that cannot be written to never claims it can,
- `manifest`, a JSON Schema for the body a write to the scheme's root makes something from, when the provider serves one.

A provider describes itself through an optional `describe()` on `ResourceProvider`, answering a title, an optional line of prose and an optional manifest. A provider that does not implement it is advertised by its scheme and its operations alone, which is still true.

The key is `ahpd.`-prefixed because it is this implementation's, and a client that does not know it ignores it, which the protocol says is correct. A client that does know it draws a screen from the description and never has to ask a URI under a scheme to find out whether the scheme exists.

The typed `InitializeResult` field is where this should end up once it is interoperable. This decision is the interim that works with the released protocol, and it is written down so the typed field, when it exists, supersedes it rather than being discovered later.

## Consequences

A client can tell before any object exists that this host serves `computer:`, what it can do, and what a create body takes; ahpapp is the first client to read it, and a second scheme from a second plugin arrives in the same map with no client change.
The map is generated from what is registered, so a plugin that is not loaded contributes nothing and a scheme that is loaded cannot be silently absent.
VS Code is unaffected: its UI reads `_meta` only for known `vscode.*` keys, so this key is invisible there and no client is worse off for it.
The description is a claim by the provider about its own scheme, which is the same kind of claim `effects` and `advancedPermission` already are: it is not a guarantee, and a client that acts on it still has to read what a real command answers.
`RootState._meta` is echoed on every root snapshot, so a client that reconnects or subscribes later reads the same facts without a second handshake.
`describe()` is a public SDK addition, so every provider gains an optional method and the plugin validation allows one it does not demand.

## Options

- **A typed `InitializeResult.resourceSchemes` field.** Rejected for now, not on merit: it is where this belongs, and it needs the protocol repository and every client to move first, which this repository does not depend on.
- **Probe the scheme and read the error.** Rejected: it is feature detection through prose on an error, it cannot describe a create body before a first object exists, and the protocol's own guidance is capabilities rather than probes.
- **Advertise in the root `_meta` only.** Rejected: a client reads `_meta` off the handshake before it subscribes to anything, and putting it in one place only would make a reconnecting client wait for a subscription it may not need.
- **Hardcode `computer` in the host's `_meta`.** Rejected: the host would learn what a container is, and a second plugin scheme would need a second hardcode rather than the same one.
