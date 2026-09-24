# Users and permissions

`ahpd` has one secret by default: the connection token. Everybody who holds it
is the same caller, and the host has no idea who anybody is.

A **user directory** changes that. There are two layers, and they are separate:

- **The door** decides whether a socket may exist. The deployment's own token
  opens one and is the host. A person's own token opens one and, by default,
  says nobody.
- **Authorization** is the protocol's `authenticate`. A person is nobody until
  they do it, whichever door let them in.

Nothing here is on unless a file is configured: a daemon with no `users` key
behaves exactly as it did before this existed.

## The door and the authorization

| | The deployment's token | A person's own token | `authenticate` |
| --- | --- | --- | --- |
| Where it is presented | `?tkn=` on the WebSocket URL, or a bearer header | the same, with the secret `ahpd user token` printed | the command, against the resource the host advertises |
| What it answers | whether a socket may exist at all | that, and nothing else | who is on the other end, for a socket that arrived as nobody |
| Identity | the host itself, when a directory is configured | nobody, unless the record sets `trustToken` | the person the directory or the issuer resolves the token to |
| How it is revoked | rotate the token, restart, everybody reconnects | `ahpd user rm`, and the next connection is refused | `ahpd user rm`, and the next command is refused |
| How many | one, shared | one per person | one per person |
| Expiry | none | none | `expiresIn`, honoured |

The deployment's token needs no credential. A socket on it is the host: every
capability, including a scheme no role names, because the key to the door is the
operator's own. It is the one thing `authenticate` cannot demote or revoke, and
the one thing never asked to justify itself.

Everything else is a door and nothing more. A person's own token opens the
socket and the first gated command answers `-32007`, so the client signs in.
That is the default because a token in a URL can end up in a log and a login
does not. Two things opt out of it:

```json
{
  "trustToken": true,
  "users": [
    { "id": "normal", "roles": ["guest"], "token": "sha256:…", "trustToken": true }
  ]
}
```

`trustToken` at the top of the configuration trusts everybody's connection
token; on a record it decides for that one person and wins over the host. Use it
for a client that cannot complete a sign-in, such as a phone with only a URL to
paste. A host that wants the token to be enough everywhere sets it once.

`authenticate` is unchanged and remains the protocol's way in, and it is the
only way in for a credential an issuer mints rather than this file.

Removing a user **does not close their socket**, but the next command on it is
refused `-32007`: the directory is read again for every command, so removal and a
role change both take effect at once, with no reconnection. Rotating the
deployment's token is what locks somebody out of the door entirely, and that
token is the host itself.

## Three shapes

1. **One person, the deployment token only.** No `users` key, no directory.
   This is the default and it is unchanged.
2. **Several people.** A deployment token for the door, when the port is not
   loopback, and a token per person. Each person signs in with `authenticate`,
   against their issuer or with the secret `ahpd user token` minted, and a
   person whose client cannot do that is given `trustToken` instead.
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
headers on a WebSocket. It opens the door and says nobody, so the person still
signs in with `authenticate` unless the record is trusted - the URL is a
convenience for reaching the socket, not the credential itself.

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

## An issuer, when a client needs one

A host that is its own issuer mints every secret and prints it for a person to
paste. A client that only acquires tokens through an OAuth provider cannot do
anything with a pasted secret, so a deployment can name an authorization server
instead:

```json
{ "users": "/home/me/.config/ahpd/users.json", "issuer": "github" }
```

or `--issuer github`, or `--issuer https://login.example.com` for an OpenID
Connect issuer. The record then carries it, which is the field plan 07 left
empty on purpose:

```json
{
  "resource": "https://127.0.0.1:9187/",
  "resource_name": "ahpd users",
  "authorization_servers": ["https://github.com/login/oauth"],
  "scopes_supported": ["read:user"],
  "resource_documentation": "https://github.com/softov/ahpd/blob/main/docs/USERS.md",
  "required": true
}
```

A client resolves a provider for that identifier, obtains a token, and pushes it
through `authenticate` exactly as the protocol says. This host then asks the
issuer who the token belongs to, and the answer is matched against a record's
`id`: a GitHub login, or an OpenID Connect `sub`. The roles still come from the
file, because the file is the only place that says who may do what.

```json
{
  "users": [
    { "id": "octocat", "roles": ["member"], "token": "" }
  ]
}
```

### An issuer per person

The `issuer` key is the **default**: a record that names one of its own uses
that instead. So one host can take a GitHub login for one person and a token
from a company identity provider for another, without a second daemon:

```json
{
  "users": [
    { "id": "octocat", "roles": ["member"], "token": "", "issuer": "github" },
    { "id": "ana", "roles": ["member"], "token": "", "issuer": "https://idp.example.com" },
    { "id": "sam", "roles": ["guest"], "token": "" }
  ]
}
```

`sam` names none, so he signs in through whatever the configuration's `issuer`
is, or through a minted secret when there is none. A record's `issuer` is the
same name the configuration takes: `github`, or an issuer URL this host may
reach. A name that is neither is reported on stderr and never verifies, the way
a grant that is not `<subject>:<verb>` is.

It can be set from the command line instead of by hand:

```sh
ahpd user add ana --role member --issuer github
ahpd user add sam --role guest                  # the configuration's default
```

`--issuer` on a record that already exists moves that person to that provider,
and leaving it off never moves them to the default: `add` sets the roles, and
the provider only when the flag names one. A name nothing can resolve is refused
before anything is written.

### Roles from the issuer

A record may name the claim its roles arrive in:

```json
{
  "roles": { "operators": ["file:read", "file:write", "terminal:read", "terminal:write"] },
  "users": [
    { "id": "ana", "roles": ["guest"], "token": "", "issuer": "https://idp.example.com", "rolesFrom": "groups" }
  ]
}
```

The claim's values are **role names this file defines** or built-ins, and they
are added to the roles on the record. The issuer never names a grant: a
`groups` value of `operators` reaches the grants above because this file wrote
them, and a value that names no role here is reported on stderr and dropped. An
issuer that omits the claim contributes nothing, which is not a refusal.

That is the one place the issuer is half an authority, and it is deliberate: an
administrator of that provider can put somebody into a role this host defines,
and cannot invent one.

The two halves move on different clocks. The claim is read once, at sign-in,
because asking again would mean keeping the token. The record's own roles are
read on every command, so removing a person still lands at once and a change at
the issuer lands the next time they sign in.

`ahpd user list` prints the claim so the file and the answer can be compared:

```
ana (guest) session:read automation:read sign-in https://idp.example.com rolesFrom=groups
```

The advertised record lists every provider any of this answers for, because that
is the list a client resolves one from:

```json
{
  "resource": "https://127.0.0.1:9187/",
  "authorization_servers": ["https://github.com/login/oauth", "https://idp.example.com"],
  "scopes_supported": ["read:user", "openid"],
  "required": true
}
```

`scopes_supported` is the union, so a client that asks for all of them asks one
provider for a scope it does not know. A client picks the provider it has and
asks for what that one wants; the union is there because the field is flat.

Which provider minted a token is not something the token says, so a token that
matched no minted secret is offered to the host's default first and then to each
issuer a record names, in the order the file lists them. The first subject that
names a record wins. A host with several issuers therefore shows a token to more
than one of them, which is the cost of the feature rather than an accident.

### The issuer has to be reachable, and what counts as reachable

The host fetches `<issuer>/.well-known/openid-configuration`, reads
`userinfo_endpoint` from it, and asks that endpoint with
`Authorization: Bearer <token>`, taking `sub` as the subject. So the issuer must
publish both, and an identity provider that does not is one this option cannot
use.

An issuer URL is accepted over **https anywhere**, and over plain **http only on
loopback** - `127.0.0.1`, `::1` or `localhost`. A local issuer is common and
nothing leaves the machine there; a remote one over http would put a bearer
token in clear. A remote issuer with a self-signed certificate needs its CA
trusted, or `fetch` fails and every token reads as nobody: start the daemon with
`NODE_EXTRA_CA_CERTS=/path/to/ca.pem`.

### Trying it

Three ways, in the order they take to set up:

- **GitHub**, which needs no issuer to run: `"issuer": "github"`, then a person
  with the id of their GitHub login, and a token from GitHub with `read:user`.
  A stock VS Code resolves its own GitHub provider for it.
- **The dev issuer**, which verifies nothing and answers any token as its own
  subject: `node scripts/dev-issuer.mjs 9310`, then
  `--issuer http://127.0.0.1:9310`. `Bearer ana` answers `sub: ana`, so a record
  with id `ana` can sign in with the token `ana`. `Bearer ana|ops,eng` answers
  `groups: [ops, eng]` as well, which is a record's `rolesFrom` reading a claim.
- **A real identity provider** - Keycloak, Authentik, Zitadel, Entra, Auth0 -
  named by its issuer URL.

Two run at once: the dev issuer is the default, and one record names GitHub
instead, so a token from either signs in the person whose record says so:

```json
{
  "issuer": "http://127.0.0.1:9310",
  "users": [
    { "id": "ana", "roles": ["admin"], "token": "" },
    { "id": "octocat", "roles": ["guest"], "token": "", "issuer": "github" }
  ]
}
```

`ahpd user list` says where each record signs in, so the file and the answer can
be compared without signing in:

```
ana (admin) *:* sign-in http://127.0.0.1:9310
octocat (guest) session:read automation:read sign-in github
```

An issuer adds a way in and takes nothing away, so configuring one does not
close the local one. A person is challenged once, at the first command that
needs a grant, and the deployment's own connection token is the host, so the
operator is never challenged at all.

Three things worth knowing:

- A secret this host minted is checked first, and the issuer is asked only when
  nothing matched. A deployment can run both, and a person holding a minted
  secret never depends on the issuer being reachable.
- A token the issuer refuses and an issuer that cannot be reached both answer
  `-32007`. The host does not pretend to know which it was, and a client cannot
  tell either, so the advice is the same in both cases: sign in again.
- A record with no minted secret is a protocol credential and not a connection
  token. The door is decided before the socket exists, and the issuer is not
  asked there, so such a person pastes nothing and signs in through
  `authenticate`.

## Roles

A grant is a **subject** and a **verb**: `session:read`, `file:write`,
`computer:read`. The verb comes last, which is the convention every scope list
uses - `contents:read` in GitHub's app permissions, `channels:read` in Slack's,
`s3:GetObject` in IAM.

The subjects are the host's own five and any plugin's URI scheme:

| Subject | Verbs | What they cover |
| --- | --- | --- |
| `file` | `read`, `write` | Resources, and a write is anything that changes one: save, delete, move, copy |
| `session` | `read`, `write` | Read lists sessions, their turns and their config; write creates and disposes them |
| `automation` | `read`, `write` | Read lists the triggers and the runs; write runs one |
| `terminal` | `read`, `write` | Read watches a shell's output; write opens one, types into it and closes it |
| `diagnostics` | `read` | `diagnosticsFetch` |
| a plugin's scheme | `read`, `write` | That provider's resources, exactly as before |

`*` stands in either position: `*:read` is every subject's read, `session:*` is
every verb on sessions, `*:*` is everything.

| Role | Has |
| --- | --- |
| `admin` | `*:*` |
| `member` | `file:read`, `file:write`, `session:read`, `session:write`, `terminal:read`, `terminal:write` |
| `guest` | `session:read`, `automation:read` |

`guest` is the default for `ahpd user add` with no `--role`, and it is the one
worth looking at twice: it lists the sessions and the automations and can do
nothing about either - no file, no shell, no session of its own, no automation
run.

A plugin's scheme is never conferred by a plain subject. `file:write` is not
`computer:write`; a role reaches a scheme by naming it (`computer:write`) or by
naming a wildcard that covers it (`*:*`). The computer is the worked example:
reading a machine is `computer:read` and making or destroying one is
`computer:write`, so a person who may save a file may not, by that alone, start
a container - see [COMPUTER.md](COMPUTER.md). That is deliberate: a role that may
save your files may not, by that alone, start a container on your host. The
refusal tells you what to add - the `-32009` message is
`<person> may not computer:write here` - so the way to discover a subject is to
try it once and read the answer.

Define your own in the same file; a file role overrides a built-in of the same
name:

```json
{
  "roles": {
    "viewer": ["*:read"],
    "editor": ["file:read", "file:write", "session:read", "session:write"]
  },
  "users": [
    { "id": "ana", "roles": ["admin"], "token": "sha256:…" },
    { "id": "sam", "roles": ["viewer"], "token": "sha256:…" }
  ]
}
```

A role name that is neither built in nor defined in the file is refused when the
person is added, so a typo is a refusal rather than a person who may do nothing.
A grant that is not a subject and a verb is reported when the file is read and
dropped. A file that is malformed is read as nobody - it fails closed - and it
is never written over.

`ahpd user list` prints the roles, the grants they resolved to, whether the door
already identifies the record or the person still has to sign in, and the issuer
when their credential comes from one:

```
normal (guest) session:read automation:read sign-in http://127.0.0.1:9310
sam (member) file:read file:write session:read session:write terminal:read terminal:write trusted
```

## What a client is told

| | |
| --- | --- |
| Not signed in, command needs a grant | `-32007` `AuthRequired`, with `data.resources` carrying the record to sign in against |
| Signed in, role does not cover the command | `-32009` `PermissionDenied`, with **no** `data.request` |

A dispatched action is refused differently, because it has to be. `dispatchAction`
is a notification and carries no id, so there is nowhere to put an error code:
what comes back is the ordinary `action` notification with `rejectionReason` on
it, the same way every other refused action is answered. What it is checked
against is the **channel**, not the action, and a dispatch is always a write: a
session or a chat needs `session:write`, a terminal needs `terminal:write`, an
automation needs `automation:write`, `ahp-root://` needs `file:write` because the
one thing a client may dispatch there changes a setting for everybody, and
anything else needs `file:read`.

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
to produce. It does take a WebSocket URL in Add Remote Agent Host, so the URL
from `ahpd user token <id> --url` reaches the socket. That URL is a door and not
a credential now, so the window is connected and still nobody: a deployment that
reaches VS Code with minted secrets sets `trustToken` on the record, which makes
that one person's token their authorization, and a deployment with an issuer
needs neither.

An issuer is what lets a client acquire a credential through its own OAuth flow
rather than being handed one, and it is configured with `issuer`. With `github`
in the configuration a stock client resolves its GitHub provider and signs in
with no extension; an enterprise names its own OpenID Connect issuer instead.
Plan 07's research file records what the reference client does with the field
and why it could not carry a pasted secret.
