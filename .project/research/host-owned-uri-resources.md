---
title: Proposal for host-owned URI resources beside files
---

# Host-owned URI resources beside files

## Question

Can an `ahpd` plugin expose `computer:` or another non-file resource without replacing the daemon's filesystem resource store?

The AHP resource commands already take URIs.
The current `ResourceStore` contract also takes URI strings, so AHP does not require every resource to be a file on this host.
Client-published `virtual:` resources and changeset reads already show that resource bytes can have another owner.
The gap is how host-owned resource providers are composed.

## Current behavior

The daemon passes one `fileResources()` store as `HostOptions.resources`.
The plugin API has one `registerResources(store, when?)` slot.
A plugin must request `replace` to take that slot, which loses ordinary file resources unless the plugin wraps or recreates the existing store.
Most resource commands call that one store directly; `resourceRead` asks the changeset source first.
The built-in file store explains non-`file:` URIs as belonging to some other source.

This behavior is coherent for the current daemon and is not a protocol violation.
It becomes awkward when a plugin wants to add one host-owned URI scheme alongside files.
The accepted [plugin contribution decision](../decisions/plugin-contributes-host-options.md) intentionally made ports singleton, so changing that needs an explicit design choice rather than treating it as a defect in the original implementation.

## Proposal

Keep `registerResources` and `HostOptions.resources` as the default filesystem store for compatibility.
Add a narrowly scoped `registerResourceProvider(scheme, store)` contribution for a host-owned URI scheme.
The host routes `resourceList`, `resourceRead`, `resourceResolve`, completions, writes, and watches by URI owner.
`file:` continues to use the existing store, client-published resources continue to use their client route, and a changeset URI continues to use its changeset source.
An unknown scheme receives a clear unsupported-resource error.

Registration should reject duplicate schemes and reserved schemes such as `file:` and schemes owned by connected clients.
The provider must use the same `ResourceStore` shape only where that shape makes sense; a read-only provider omits its write methods.
If the current `ResourceStore` contract forces file metadata or path completion on all schemes, introduce a smaller read-only URI provider contract rather than inventing fake file semantics.
Cross-provider move and copy should be refused unless a separate, explicit transfer contract exists.
Resource authorization must be decided for the scheme; the current blanket `file:` grant in `resourceRequest` must not silently grant `computer:` writes.

An initial example could serve read-only `computer://<id>/status` and `computer://<id>/capabilities` from a plugin.
The data would be useful to an agent or a client that knows those URIs.
Resource commands alone do not provide a discoverable top-level machine catalogue or a client UI picker, so the master still needs discovery and routing.

## Server tools and UI

An `ahpd` plugin can already `registerTool`.
Host tools are reported in `SessionState.serverTools`, and `session/serverToolsChanged` updates that list.
A client can choose to show them in its UI; the current `ahpapp` tools pane reads client-published tools, so showing host tools there would be a client change.
A tool such as `request_disposable_computer` would be an agent-callable operation within a session, not the user's primary machine selector before a session exists.
The master should authorize the operation, and the tool should only send a request to it.

## Smaller alternative

An `ahp-server` plugin could register a read-only `computer_status` server tool and leave resources unchanged.
That is enough if agents only need to ask for machine information on demand.
It does not provide URI-based browsing or resource updates to clients.
This alternative should be tried first if no client needs the resource commands.

## Validation needed

- A plugin adds a `computer:` read-only provider while `file:` listing and reads still work.
- Client-published and changeset resources keep their current routing precedence.
- Duplicate and reserved scheme registrations fail at plugin load with a useful error.
- A `computer:` write is refused unless that provider explicitly implements and authorizes it.
- A client can read a known `computer:` URI, while UI discovery is evaluated separately.
- Host tools remain visible in session state and are displayed only by clients that implement that UI.

## References

- [`code://packages/sdk/src/types/resources.ts#L125`](../../packages/sdk/src/types/resources.ts#L125) defines the current URI-taking resource store.
- [`code://packages/sdk/src/types/plugin.ts#L100-L110`](../../packages/sdk/src/types/plugin.ts#L100-L110) defines the singleton plugin registration.
- [`code://packages/server/src/main.ts#L455-L462`](../../packages/server/src/main.ts#L455-L462) installs the default file store.
- [`code://packages/sdk/src/host.ts#L5024-L5037`](../../packages/sdk/src/host.ts#L5024-L5037) routes resource lists and reads.
- [`code://packages/sdk/src/types/host.ts#L153-L160`](../../packages/sdk/src/types/host.ts#L153-L160) describes server tools in session state.
