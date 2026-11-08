---
title: Resources and channels
status: current
covers:
  - packages/sdk/src/host/resourcemethods.ts
  - packages/sdk/src/host/root.ts
  - packages/sdk/src/host/admission.ts
  - packages/sdk/src/host/channels.ts
  - packages/sdk/src/types/resources.ts
  - packages/sdk/src/resources/recordschannel.ts
  - packages/sdk/src/plugins/validate.ts
  - packages/push/src/**
decisions:
  - decisions/a-plugin-channel-filters-each-action-per-subscriber.md
refs:
  - "[code://packages/sdk/src/host/resourcemethods.ts#L62-L71](../../packages/sdk/src/host/resourcemethods.ts#L62-L71) - `storeFor`, which routes a URI by its scheme"
  - "[code://packages/sdk/src/host/resourcemethods.ts#L268-L276](../../packages/sdk/src/host/resourcemethods.ts#L268-L276) - `resourceRequest`, which answers `{}` for a `file:` URI"
  - "[code://packages/sdk/src/resources/resources.ts#L68-L84](../../packages/sdk/src/resources/resources.ts#L68-L84) - `notServed`, the `-32601` for a scheme nobody serves"
  - "[code://packages/sdk/src/types/resources.ts#L259-L288](../../packages/sdk/src/types/resources.ts#L259-L288) - `ResourceProvider`"
  - "[code://packages/sdk/src/host/root.ts#L23-L48](../../packages/sdk/src/host/root.ts#L23-L48) - `schemeOperations`, the operations read off a provider's methods"
  - "[code://packages/sdk/src/host/root.ts#L352-L408](../../packages/sdk/src/host/root.ts#L352-L408) - the advertised schemes, channels and commands"
  - "[code://packages/sdk/src/host/root.ts#L521-L523](../../packages/sdk/src/host/root.ts#L521-L523) - the three keys in `RootState._meta`"
  - "[code://packages/sdk/src/host/handshake.ts#L330-L336](../../packages/sdk/src/host/handshake.ts#L330-L336) - the same keys in `initialize._meta`"
  - "[code://packages/sdk/src/host/gate.ts#L35-L42](../../packages/sdk/src/host/gate.ts#L35-L42) - the `file` operations each resource method needs"
  - "[code://packages/sdk/src/host/admission.ts#L195-L215](../../packages/sdk/src/host/admission.ts#L195-L215) - a resource method needs the grant of the URI's scheme"
  - "[code://packages/sdk/src/host/admission.ts#L239-L320](../../packages/sdk/src/host/admission.ts#L239-L320) - `excusedBy`, where `authorize` widens a read"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1064-L1114](../../packages/sdk/src/plugins/plugins.ts#L1064-L1114) - `registerResourceProvider`, `registerChannel` and `registerMethod`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L384-L416](../../packages/sdk/src/plugins/plugins.ts#L384-L416) - a scheme, channel or command that another plugin already has"
  - "[code://packages/sdk/src/plugins/validate.ts#L213-L248](../../packages/sdk/src/plugins/validate.ts#L213-L248) - `checkScheme` and `reservedName`"
  - "[code://packages/sdk/src/types/plugin.ts#L175-L232](../../packages/sdk/src/types/plugin.ts#L175-L232) - `PluginChannel`, `PublishOptions` and `ChannelHandle`"
  - "[code://packages/sdk/src/host.ts#L708-L783](../../packages/sdk/src/host.ts#L708-L783) - `projectActionForClient`, the test of each action per subscriber"
  - "[code://packages/sdk/src/host/actions.ts#L82-L90](../../packages/sdk/src/host/actions.ts#L82-L90) - a client's action on a plugin channel is refused"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L245-L246](../../packages/sdk/src/resources/recordschannel.ts#L245-L246) - the `put` and `remove` command names of a records domain"
  - "[code://packages/push/src/provider.ts#L117-L125](../../packages/push/src/provider.ts#L117-L125) - `shownOf`, a device without its token"
  - "[code://packages/push/src/provider.ts#L313-L340](../../packages/push/src/provider.ts#L313-L340) - a device write and a device removal"
  - "[code://packages/sdk/test/uri-resources.test.ts#L74-L94](../../packages/sdk/test/uri-resources.test.ts#L74-L94) - `-32601` for a missing method and for an unserved scheme"
  - git://d9d4f950^ - the deleted decisions this spec was written from: a-device-registers-for-push-by-writing-a-resource, a-push-token-is-write-only, a-plugin-channel-is-an-x-scheme, a-plugin-serves-an-x-command, a-resource-scheme-is-advertised-in-meta, a-scheme-nobody-serves-is-not-a-permission-error, a-scheme-provider-implements-less-than-a-resource-store, a-scheme-provider-may-authorize-a-read-itself, an-x-command-is-named-by-domain-and-verb, client-writes-are-served-not-gated, host-owned-schemes-are-provider-contributions, host-records-are-typed-channels-beside-their-resource-schemes
---

The host serves `file:` from its file store, and a plugin or the daemon can add more URI schemes, channels and commands beside it.
A resource provider serves one scheme through the protocol's `resource*` methods, and the host routes each URI by its scheme.
A plugin channel is an `x-` scheme that a client subscribes to, and only its plugin sends actions on it.
A served command is an `x-` method that a client sends as any other request.
The host lists all three in `_meta`, so a client finds them without a probe.
The routing is in [`code://packages/sdk/src/host/resourcemethods.ts`](../../packages/sdk/src/host/resourcemethods.ts), and the advertisement is in [`code://packages/sdk/src/host/root.ts`](../../packages/sdk/src/host/root.ts).

## Scenarios

### A plugin adds a resource scheme

WHEN a plugin calls `registerResourceProvider(scheme, provider)`
THEN the host routes every resource command whose URI has that scheme to the provider
AND `file:` keeps the store in `HostOptions.resources`.

WHEN a client published the URI itself
THEN the host relays the command to that client before any provider sees it.

WHEN another plugin or the daemon already serves the scheme, or an agent uses that name
THEN the second registration is a problem line, and the first one stays.

WHEN the scheme is reserved
THEN the registration is refused when the plugin applies.

The reserved names are `file`, `automations`, every grant subject and the schemes a client opens itself, such as `https`.
A name that starts with `ahp-`, `ahpd-` or `x-` is reserved too.
This is so that two plugins can each own a scheme, and neither one wraps the file store.

### A provider implements only what it serves

WHEN a plugin registers a provider
THEN the provider has `read`, and `list`, `resolve`, `watch`, `describe`, `authorize` and the write methods are optional.

WHEN a client calls a method the provider does not implement
THEN the host answers `-32601`, the same answer as for a store that only reads.

A provider has no `complete`, because path completion stays with the file store.
The reason: a scheme such as `computer:` has no paths and no directories, so a full file store contract would make it invent them.

### A scheme nobody serves

WHEN a resource command names a scheme that no provider serves and no client publishes
THEN the host answers `-32601` before the file store is asked
AND the message is "<uri> is not this host's to read: nothing here serves <scheme>:, and no connected client publishes it".

`-32009` stays for a role that does not cover a command, and for a store that refuses a path.
This is so that a client can tell a missing feature from a refusal by the code, without reading the sentence.

### A client finds what the host serves

WHEN a client reads `initialize._meta` or `RootState._meta`
THEN `ahpd.resourceProviders` maps each served scheme to its title, description, root and operations
AND `ahpd.channels` lists each plugin channel with its title and the grant a subscribe needs
AND `ahpd.methods` lists each served command with its title and the grant a call needs.

WHEN a provider implements `describe()`
THEN its title, description and manifest go into its entry.

WHEN no provider, channel or command is registered
THEN the matching key is absent.

The operations are read off the methods the provider implements, with the grant words `get`, `list`, `resolve`, `watch`, `put`, `delete`, `mkdir`, `move` and `copy`.
The same helper fills each scheme's entry in `ahpd.grants`, so the two lists cannot drift.
The keys use the `ahpd.` prefix because the protocol has no typed field for them.
A client that does not know a key ignores it.

### A resource command needs the grant of its scheme

WHEN a person sends a resource command on a `file:` URI
THEN the gate asks for the plain `file` operation, such as `file:put` for `resourceWrite`.

WHEN the URI has another scheme
THEN the gate asks for `<scheme>:<operation>`, such as `computer:get` for `resourceRead` on `computer://`.

WHEN a client sends `resourceRequest` for a `file:` URI
THEN the host logs the ask and answers `{}`, and grants nothing.

WHEN the URI of a `resourceRequest` is not a `file:` URI
THEN the host refuses it with `-32009`.

The role of a person decides what a resource command may do, and no grant is negotiated for each connection.
A host with no users directory gates nothing.

### A provider widens a read

WHEN a person without `<scheme>:get` sends `resourceRead` on a URI of the scheme
AND the provider implements `authorize(uri, reader)`
THEN the gate asks the provider before it refuses
AND a `true` answer lets that one read through.

WHEN the command is `resourceList`, `createResourceWatch` or a subscribe to such a watch
THEN `authorize` is asked the same way.

WHEN the command writes
THEN `authorize` is not asked.

This is how a person reads their own `usage://` pools without a `usage` grant, with no rule in the host.
The reason it widens only reads: a provider that answers wrongly can show too much, but it cannot change anything.

### A plugin serves a channel

WHEN a plugin calls `registerChannel(scheme, channel)`
THEN the scheme starts with `x-`, or the registration is refused
AND each action type starts with the scheme and a `/`, such as `x-ahpd-bots/added`.

WHEN a client subscribes to a URI on the scheme
THEN it needs the channel's grant, unless the channel's `authorize` lets it in
AND it gets the channel's `snapshot` for that reader as the state.

WHEN a client dispatches an action to a plugin channel
THEN the host refuses it, because the plugin is the only writer.

WHEN two plugins register the same channel
THEN the second registration is a problem line.

The `x-` prefix is the protocol's extension space, so a later protocol channel cannot take the name.

### A channel filters each action for each subscriber

WHEN a plugin publishes an action with `visible` or `to`
THEN the host keeps the test with the action
AND asks it with each subscriber's current principal and client id, at each send and at each replay.

WHEN a subscriber fails the test, or `visible` throws
THEN that subscriber does not get the action, and sees a gap in `serverSeq`.

The reason: the host has one `serverSeq` and one replay buffer for all connections.
So a filter on the snapshot alone would leak through the next action.

### A plugin serves a command

WHEN a plugin calls `registerMethod(name, method)`
THEN the name starts with `x-`, and the method has a grant and a `handle`.

WHEN a client sends the command
THEN the caller needs the method's grant, unless the method's `authorize` lets it in with these params
AND the result of `handle` is the answer.

WHEN the daemon or another plugin already serves the name
THEN the second registration is a problem line.

The host and the daemon name their commands `x-ahpd/<domain>/<verb>`, such as `x-ahpd/usage/totals` and `x-ahpd/computers/start`.
The domain is plural and is the same word as the domain's channel, such as `x-ahpd-users://`.

### Host records have a channel beside their scheme

WHEN a host has a people directory
THEN users, teams, projects and roles are served as `user:`, `team:`, `project:` and `role:` schemes
AND also as the channels `x-ahpd-users://`, `x-ahpd-teams://`, `x-ahpd-projects://` and `x-ahpd-roles://`, with `x-ahpd/<domain>/put` and `x-ahpd/<domain>/remove` commands.

The same pattern serves policies, computers and bots.
Usage has commands only, such as `x-ahpd/usage/totals`, because it is a query with no state to subscribe to.
The schemes stay beside the channels, so a client that knows only the protocol still lists and reads the records.

### A device registers for push

WHEN `@ahpd/push` is loaded
THEN it serves the `push:` scheme, and a client finds it in `ahpd.resourceProviders`.

WHEN a client writes `{ token, platform, lang }` to `push://devices/<install id>` with `resourceWrite`
THEN the plugin keeps the device with the id of the client that wrote it
AND the write needs `push:put`.

WHEN a client deletes `push://devices/<install id>` with `resourceDelete`
THEN the plugin removes the device.

The devices are kept in one JSON file, `<configDir>/push-devices.json`, that only its owner may read.
A notification goes to the devices of the client that created or opened the session.

### A push token is write-only

WHEN a client reads `push://devices/<id>`
THEN the answer has the platform, the language and the client, and never the token.

WHEN a role has `push:` write
THEN it can replace or remove the device of another client.

A client that lost its own token registers again.
The reason: a token is a credential to the notifications of one device, and grants are for a whole role.
