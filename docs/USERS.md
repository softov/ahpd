# Users and permissions

`ahpd` has one secret by default: the connection token. Everybody who holds it
is the same caller, and the host has no idea who anybody is.

A **user directory** changes that. A person holds a credential of their own, the
host checks it against a file it owns, and what they may do comes from the roles
on their record. There are three ways that credential reaches the host, and they
are distinct: the deployment's token opens a socket and names nobody, a person's
own token opens one and is who they are, and the protocol's `authenticate`
command answers a client that speaks it. Nothing here is on unless a file is
configured: a daemon with no `users` key behaves exactly as it did before this
existed.

## Three ways in

| | The deployment's token | A person's own token | `authenticate` |
| --- | --- | --- | --- |
| Where it is presented | `?tkn=` on the WebSocket URL, or a bearer header | the same, with the secret `ahpd user token` printed | the command, against the resource the host advertises |
| What it answers | whether a socket may exist at all | that, and who is on the other end | who is on the other end, for a socket that arrived as nobody |
| Identity | none: every holder is the same caller | the person whose record the secret hashes to | the person the directory resolves the token to |
| How it is revoked | rotate the token, restart, everybody reconnects | `ahpd user rm`, and the next connection is refused | `ahpd user rm`, and the next connection is refused |
| How many | one, shared | one per person | one per person |
| Expiry | none | none | `expiresIn`, honoured |

A person's own token is a connection token and a credential at once, which is
what lets a client that can only carry a URL arrive as somebody with no sign-in
step at all. `authenticate` is unchanged and remains the protocol's way in, and
it is the only way in for a credential an issuer mints rather than this file.

Removing a user **does not close their socket**, and it does not take away what
an open one was already given: a connection that arrived keeps its principal
until it drops. What removal takes away is the next connection and the next
`authenticate`. Rotating the deployment's token is what locks somebody out of
the door entirely.

## Three shapes

1. **One person, the deployment token only.** No `users` key, no directory.
   This is the default and it is unchanged.
2. **Several people.** A deployment token for the door, when the port is not
   loopback, and a token per person. Each person is given
   `ahpd user token <id> --url` and pastes it where their client asks for a
   host; a client that speaks `authenticate` may push the same secret instead.
3. **No deployment token at all.** `--without-connection-token`, so a person's
   own token is the only secret and who may reach the port is the network's
   business. A token nobody recognises is then simply a socket that is nobody:
   it is admitted, it may read root state, and every command behind the gate
   answers `-32007`. `--host 0.0.0.0` with no token is this shape whether you
   meant it or not.

## Turning it on

```json
{ "users": "/home/me/.config/ahpd/users.json" }
```

or `--users <file>`. Then:

```sh
ahpd user add ana --role admin
ahpd user token ana --url    # the whole ws:// URL, shown once
ahpd user token ana          # the secret alone, for a script
ahpd user list
ahpd user rm ana
```

The URL is composed from the configuration's `host` and `port`, or from the
`--host` and `--port` passed here when the daemon was started with them. It is
the `?tkn=` form the door already reads, which is what VS Code's Add Remote
Agent Host prompt takes and what a browser can use, since a browser cannot set
headers on a WebSocket.

The secret alone goes to stdout so it can be piped, and the warning that it is
shown once goes to stderr. Only its hash is stored, and minting again replaces
it.

A client that speaks the protocol pushes the same secret through the command
instead:

```json
{ "method": "authenticate", "params": { "resource": "<the advertised identifier>", "token": "<the secret>" } }
```

## The record the host advertises

The host advertises, on every agent, an RFC 9728 record describing its own
sign-in:

```json
{
  "resource": "https://127.0.0.1:9187/",
  "resource_name": "ahpd users",
  "resource_documentation": "https://github.com/softov/ahpd/blob/main/docs/USERS.md",
  "required": true
}
```

`resource` is the identifier a client names in `authenticate`, and it is an
https URL: the operator's when `--resource` names one, and one derived from the
host and port the daemon listens on otherwise. `resource_documentation` is this
page.

There is no `authorization_servers`. That field is a list of RFC 8414 issuer
identifiers, and this host is not an authorization server, so it is left out
rather than filled with something that is not one. An earlier version put this
page's URL there, which is worse than saying nothing: a client matches each
entry against the authentication providers it has, so an entry on `github.com`
can resolve GitHub's provider and send a person to sign in somewhere that knows
nothing about this host. The field is optional for exactly this reason. An
issuer option that would fill it honestly is a later plan.

`required` is true because every command but the handshake and `authenticate`
answers `-32007` until a person is known. The daemon prints the identifier at
startup on a `sign-in` line, so an operator can see what a client will be told
without reading root state.

## Roles

Six capabilities: `read`, `write`, `session`, `terminal`, `automation`,
`diagnostics`.

| Role | Has |
| --- | --- |
| `admin` | all six |
| `member` | `read`, `write`, `session`, `terminal` |

A role can also be scoped to a URI scheme - `read:computer`, `write:computer` -
and holding the plain capability does **not** confer the scoped one. That is
deliberate: a role that may save your files may not, by that alone, start a
container on your host. A plugin invents a scheme, so a role names it.

`admin` is the six capabilities and no scheme: there is no wildcard, and nothing
enumerates the schemes a plugin might register, so even an admin names
`read:computer` to read one. The refusal tells you exactly what to add - the
`-32009` message is `<person> may not read:computer here` - so the way to
discover a scope is to try it once and read the answer.

Define your own in the same file; a file role overrides a built-in of the same
name:

```json
{
  "roles": { "viewer": ["read"] },
  "users": [
    { "id": "ana", "roles": ["admin"], "token": "sha256:…" },
    { "id": "sam", "roles": ["viewer"], "token": "sha256:…" }
  ]
}
```

A role a record names and nothing defines contributes nothing and is logged,
so one bad line does not lock everybody out. A file that is malformed is read
as nobody - it fails closed - and it is never written over.

## What a client is told

| | |
| --- | --- |
| Not signed in, command needs a capability | `-32007` `AuthRequired`, with `data.resources` carrying the record to sign in against |
| Signed in, role does not cover the command | `-32009` `PermissionDenied`, with **no** `data.request` |

A dispatched action is refused differently, because it has to be. `dispatchAction`
is a notification and carries no id, so there is nowhere to put an error code:
what comes back is the ordinary `action` notification with `rejectionReason` on
it, the same way every other refused action is answered. What it is checked
against is the **channel**, not the action: a session or a chat needs `session`,
a terminal needs `terminal`, an automation needs `automation`, `ahp-root://`
needs `write` because the one thing a client may dispatch there changes a
setting for everybody, and anything else needs `read`.

That half is not optional. Root state names every open terminal's URI, and
`terminal/input` writes to a shell, so a dispatch nobody checked is a command
anybody can run.

One key inside `ahp-root://` is not the host's at all. `defaultShell` names the
binary a host-managed terminal opens, and the host's own note calls these "the
preferences a *client* holds" - VS Code pushes it out of a per-person setting
the moment it connects. It is kept on the connection that pushed it and read
from nowhere else, so two people on one daemon each get their own shell and
neither can name the binary the other's terminal opens.

The paths with no connection in hand take the daemon's own shell, `$SHELL` and
then `/bin/sh`, and no person's preference at all: a `!command` typed in a chat,
and the factory a backend opens a terminal with during a tool call. That is
deliberate. It costs an agent's terminal the shell you chose in your client, and
it closes the path where writing a file and naming it here would have made the
next tool call in anybody's session run it.

One wrinkle worth knowing: the action is still echoed to every client watching
the root, because sequence numbers and the replay buffer are one per host. So a
client can *see* another's shell go past in a live update. What it reads back in
its own root state is its own or nothing, because the snapshot is taken per
connection, and nothing on the host opens a shell with the shared copy.

The absent `request` is the point: a grant would resolve the first, and nothing
resolves the second, so a client that reads the field correctly stops instead of
retrying. A VS Code window shows a read-only role as a `NoPermissions` dialog
with nothing to click, which is correct behaviour for that person and the reason
roles are configuration rather than a default.

## What is readable before signing in

The agent list, a session count, the root config, and every open terminal's URI,
title and claim - including, when a session opened it, that session's and chat's
URIs. Knowing a channel is not being able to drive it: a dispatch into any of
them is refused unless the person signed in and their role covers it.
The root state is per host, not per connection, so it cannot be filtered without
giving every connection its own sequence numbers - decision
[`a-role-refuses-at-the-dispatch-boundary`](../.project/decisions/a-role-refuses-at-the-dispatch-boundary.md)
says why, and `protectedResources` is the reason it must be readable at all: it
is what tells a client where to sign in.

## Clients

`ahpc` and `ahpapp` both push a token through `authenticate`, and both accept a
token pasted by hand, so a directory works from either one today.

VS Code is the client that could not, and the reason this page changed. It
acquires a token only from an authentication provider it can match through
`authorization_servers`, and it has no field for a pasted secret, so a
self-issued credential has no route through its sign-in flow: it reports the
`-32007` as a plain error with nothing to click, which is what a directory used
to produce. What it does have is a connection token - Add Remote Agent Host
takes a WebSocket URL - so a person pastes what `ahpd user token <id> --url`
printed and is themselves from the first frame. No extension and no change in
the client.

An identity provider behind the same `Users` port is a later plan. The host asks
its port whether a token is somebody's, and an issuer such as GitHub could
answer that instead of the file, which is what would let a client acquire a
credential through its own OAuth flow rather than being handed one.
