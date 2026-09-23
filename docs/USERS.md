# Users and permissions

`ahpd` has one secret by default: the connection token. Everybody who holds it
is the same caller, and the host has no idea who anybody is.

A **user directory** changes that. A person signs in with a credential of their
own, the host checks it against a file it owns, and what they may do comes from
the roles on their record. Nothing here is on unless a file is configured: a
daemon with no `users` key behaves exactly as it did before this existed.

## Two secrets

| | Connection token | Credential |
| --- | --- | --- |
| Where it is presented | `?tkn=` on the WebSocket URL, or a bearer header | `authenticate`, against the resource the host advertises |
| What it answers | whether a socket may exist at all | who is on the other end, and what they may do |
| How it is revoked | rotate the token, restart, everybody reconnects | `ahpd user rm`, and the next command is refused |
| How many | one, shared | one per person |
| Expiry | none | `expiresIn`, honoured |

Removing a user **does not close their socket**. They still hold the connection
token, so they can open one and read the root state; what they lose is every
command behind the gate. Rotating the connection token is what locks somebody
out of the door.

## Three shapes

1. **One person, connection token only.** No `users` key, no directory, no
   sign-in. This is the default and it is unchanged.
2. **Several people, both secrets.** A connection token for the door and a
   credential per person. The shape the directory is for.
3. **No connection token at all.** `--without-connection-token`, so the
   credential is the only secret and who may reach the port is the network's
   business. `--host 0.0.0.0` with no token is this shape whether you meant it
   or not.

## Turning it on

```json
{ "users": "/home/me/.config/ahpd/users.json" }
```

or `--users <file>`. Then:

```sh
ahpd user add ana --role admin
ahpd user token ana          # shown once, only its hash is stored
ahpd user list
ahpd user rm ana
```

`token` writes the secret alone on stdout so it can be piped; the warning that
it is shown once goes to stderr. A client presents it like this:

```json
{ "method": "authenticate", "params": { "resource": "ahpd://users", "token": "<the secret>" } }
```

`ahpd://users` is what the host advertises on every agent. A deployment that
fronts several hosts should give each its own id, so clients do not confuse
them.

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

## Not yet

`ahpc` and `ahpapp` do not send `authenticate` for a host-level resource, so a
directory is usable today only from a client that has learned the flow. Both
need that work before a user directory is useful from them.

An identity provider is a later port implementation: the host asks its `Users`
port whether a token is somebody's, and a master that mints route tickets can
answer that question instead of the file.
