# Resources

A **resource** is anything a client reaches by URI through one family of methods, whatever it turns out to be: a file, a directory, a person's record, a policy row, what a pool has been charged. The methods are the protocol's `resource*` family, and every one of them is routed by the **scheme** - the part before the colon - to whatever store serves it. `file:` is the store the daemon has, and every other scheme is one it registered or a connected client publishes.

Terms, one line each:

| Term | |
| --- | --- |
| a resource | Anything read or written by URI, through the `resource*` methods |
| a scheme | The part of a URI before the colon, which decides who serves it |
| the file store | `file:`, the filesystem of the machine the daemon runs on |
| a provider | A store a plugin contributes for one scheme, beside `file:` |
| a published resource | One a connected client answers for, at `<scheme>://<clientId>/...` |
| the resource watch | A channel per watched path, `ahp-resource-watch:/<uuid>` |
| a scheme's manifest | The JSON Schema a scheme publishes for the form a create is drawn from |

## What `file:` serves

The whole filesystem this process can see, as the reference host serves it: any directory may be listed and any file read, and the connection token is the boundary rather than the directories the daemon was started with. A window's folder dialog walks the disk through `resourceList` and checks the pick with `resourceResolve`, which a host that refused everything outside its own paths could not answer - `paths` says where the catalogue looks and where a session goes when a client names none, and it never said who may read what.

Reading resolves the path through symlinks where it exists, so what is opened is what a listing showed rather than the text that was sent. Writing resolves the *parent* instead, because the thing being written may not be there yet, and the final open carries `O_NOFOLLOW` and refuses a symbolic link rather than following it out of where the write was aimed. A read reports its own encoding: bytes that are valid UTF-8 with no zero byte come back `utf-8`, and anything else comes back `base64` whatever the client asked for, so a client that asked for text and got a PNG is not handed four hundred thousand replacement characters.

## The verbs

One method per act, and the grants below are per operation because of it.

| Command | What it does |
| --- | --- |
| `resourceList` | One directory's entries, names only, directories first then by name |
| `resourceRead` | One file's bytes, as `utf-8` or `base64`, with the encoding reported |
| `resourceResolve` | What a URI is - type, size, times, and an `etag` a write's `ifMatch` compares against |
| `resourceMkdir` | Make a directory and the parents it needs |
| `resourceWrite` | Write, splice or create a file. `mode` is `truncate`, `append` or `insert` and `position` is read differently by each |
| `resourceDelete` | Remove a file, or a directory when `recursive` |
| `resourceMove` | Rename, refused across two schemes |
| `resourceCopy` | Copy, refused across two schemes |
| `resourceRequest` | May I read or write this. Answered yes for any `file:` URI without withholding anything, and refused `-32009` for a URI this host does not mediate |
| `createResourceWatch` | A channel that reports what changes under a path |
| `completions` | `@` completes a path, against the session's own directory |

A refusal says what it is by code: `-32601` for a scheme nothing serves, which is a host with nothing for it rather than a client being refused; `-32008` for a path that is not there; `-32009` for one this client may not see; `-32010` for a `createOnly` write onto something already there; `-32011` for a write whose `ifMatch` no longer matches; `-32602` for a request that is not one this host can act on, such as a move across two schemes.

## Schemes

`file:` is this host's own. Everything beside it is one of three things.

**A plugin's**, registered with `registerResourceProvider(scheme, provider)` - [PLUGINS.md](PLUGINS.md#what-you-can-register). The plugin names the scheme, which is kept as written, and `file:` and anything on `ahp-` are refused because they are the host's own. Two plugins cannot serve one scheme. Every scheme beside `file:` comes in this way, the daemon's own included: `computer:` is the computer plugin's, `policy:` and `usage:` are providers the daemon registers, and `user:`, `team:`, `project:` and `role:` are the users store's - [COMPUTER.md](COMPUTER.md), [POLICY.md](POLICY.md), [USAGE.md](USAGE.md), [USERS.md](USERS.md). That is the whole of how a scheme comes to be served, because a scheme is a contribution a plugin makes rather than a place the host keeps a list of - decision [A host-owned URI scheme is a provider a plugin contributes](../.project/decisions/host-owned-schemes-are-provider-contributions.md).

**A client's**, published under `<scheme>://<clientId>/...` and answered by the client whose id is the authority. `file:` is never one, and neither is any `ahp-` channel, whose authority is part of a channel's name and not a client id. A request for one goes to that client and its answer comes back verbatim, refusals included - this host has no standing to soften somebody else's `-32009`. `resourceMove` and `resourceCopy` are refused `-32602` across two clients because neither peer could carry out the other's half. This is how a plugin's virtual files, an editor's unsaved buffers and a filesystem provider reach a session, and it is the same ten methods in both directions.

**A provider's claim about itself.** A provider may answer `describe()`, which says what the scheme is called, one line about it, and the JSON Schema a write to the scheme's root makes something from. A provider may implement less than a full store: `read` is the only method required, and every other one it leaves out answers `-32601`, the same answer a read-only store's missing write half gets. That is what lets `computer:` serve bytes and say what a URI is without inventing directories it does not have.

## A watch

`createResourceWatch` hands back a channel, `ahp-resource-watch:/<uuid>`, and the client subscribes to it. Changes arrive as `resourceWatch/changed` with a batch of `added`, `updated` and `deleted` entries, never one event per file: a save that rewrites four files is one batch, and a filesystem that reports an event with no filename reports nothing rather than a directory that changed. `includes` and `excludes` are globs relative to the watched root.

Each path in a batch is `added` when it appeared after the watch began and `updated` otherwise, which is read off the file's own creation time rather than from an inventory of the tree - a tree may hold a hundred thousand files and the question is only ever asked about the handful that moved. A path already reported as added is an edit from then on, so a file created and then written twice is one appearance and two edits.

There is no dispose command, as the protocol has none: the last `unsubscribe` releases the watcher. A watch is a read, and it is gated the way a read is - a client already able to read a directory learns nothing new from being told when it moved.

## What a client is told

Two keys on the `initialize` handshake and on the root state snapshot, so a client draws a screen before it has asked for anything - [AHP.md](AHP.md#commands).

`ahpd.resourceProviders` is one entry per scheme this host serves itself, each with the provider's own description, the root URI (`<scheme>://`) and the operations the host can see it implements. It is absent when no provider is registered, because presence is what tells a client the key means anything.

`ahpd.grants` is every subject a grant may name, with the operations each has and the two groups those fall into. A scheme this host serves keeps its entry here under its own name, and the operations are the ones the provider actually implements - a provider whose `read` is granted as `get` knows the word a role is written in. Both keys are read from the wire rather than from a list of this host's own, and the two cannot drift because one helper works out a scheme's operations for both - decision [A resource scheme is advertised in `_meta`, and a client reads it there](../.project/decisions/a-resource-scheme-is-advertised-in-meta.md).

## Configuration keys

Resources have no key of their own. What changes what a client can reach is which stores and providers are loaded, and that is set where a daemon is configured or a host is built.

| Key | Values | Default | What changes |
| --- | --- | --- | --- |
| `paths` | list of directories | the directory the daemon was started in | The directories this host catalogues, and where a session goes when a client names none. It does not restrict what a client may read - the first directory is the session default, not a boundary |
| `plugins` | a list of specs | none | Which plugins are loaded, and so which schemes this host serves |

Everything else about the daemon's keys is [HOST.md](HOST.md#configuration-keys), and a host built from the SDK is given its file store and its schemes directly - [LIBRARY.md](LIBRARY.md).

## Commands

There is no `ahpd resource`: a resource is driven over the protocol, and a CLI verb reaches one only where it has a subject of its own. `ahpd user list`, `ahpd team list` and `ahpd usage` each read a scheme through the same provider a client reads, rather than holding a second copy of the rule about who may read what. The verbs and their protocol rows are the `resource*` methods above, and their wire form - params, results and the client-to-client family - is [AHP.md](AHP.md#commands) and [AHP.md](AHP.md#server-to-client-commands).

## Grants

A resource method is the one method family whose subject is not fixed: it carries a URI, and the subject is the scheme that answers it. So `resourceRead` on `file:` asks for `file:get`, and `resourceRead` on `computer://` asks for `computer:get` - a role that names the plain `file` operations does not acquire a plugin's scheme by accident. Every scheme has the same ten operations under its own name, grouped the way `file:`'s are.

| What | Grant |
| --- | --- |
| List a directory | `file:list` |
| Read a file | `file:get` |
| Resolve a URI | `file:resolve` |
| Watch a path | `file:watch` |
| Write, create or splice a file | `file:put` |
| Remove one | `file:delete` |
| Make a directory | `file:mkdir` |
| Move one | `file:move` |
| Copy one | `file:copy` |
| Ask whether a write is allowed | `file:request` |

`file:read` and `file:write` are the two **groups**, so `member`'s `file:read` and `file:write` cover every row above. The read group is `get`, `list`, `resolve` and `watch`; the write group is the other six. `member` holds both and `guest` holds neither - [USERS.md](USERS.md#roles) - decision [A grant names a subject and one of its operations, and read and write are groups of those operations](../.project/decisions/a-grant-names-an-operation-and-read-and-write-are-its-groups.md).

Two things a scheme may do on top of that. A provider may answer `authorize(uri, reader)` and let a read through that the grant would have refused - the gate asks the provider before it requires the grant, so any scheme can open part of itself to a person without a host change, and only for a read, because nothing opens a write that way - decision [A scheme provider may let a read through that its grant would refuse](../.project/decisions/a-scheme-provider-may-authorize-a-read-itself.md). And a person reads their own `user://<id>` record with no grant at all, because a client showing somebody their own account has to be able to.

A scheme nobody serves is `-32601` and not a permission answer: the host has nothing for it, which is a different fact from a client being refused - decision [A scheme nobody serves is not a permission error](../.project/decisions/a-scheme-nobody-serves-is-not-a-permission-error.md). A provider that implements less than a full store is held to the same answer for each missing method - decision [A scheme provider implements less than a resource store](../.project/decisions/a-scheme-provider-implements-less-than-a-resource-store.md).

## See also

| | |
| --- | --- |
| [AHP.md](AHP.md#commands) | The `resource*` method rows, and the two keys a scheme is advertised in |
| [AHP.md](AHP.md#server-to-client-commands) | The same ten methods in the other direction, for a resource a client publishes |
| [USERS.md](USERS.md) | Who may read what, and the people schemes this host serves |
| [TOOLS.md](TOOLS.md) | `ahp_resource`, how a session's model reaches one |
| [PLUGINS.md](PLUGINS.md#what-you-can-register) | `registerResourceProvider`, and the rest of what a plugin contributes |
| [LIBRARY.md](LIBRARY.md) | Building a host with a file store and providers of your own |
