# Authentication

How a client proves who it is. Two layers, and they are separate: the door decides whether a socket may exist, and the protocol's `authenticate` says who is on the other end. A daemon with no `users` key has only the door - one secret, held by everybody, and the host has no idea who anybody is.

| Term | What it is |
| --- | --- |
| the door | the connection token a client presents before a socket exists |
| connection token | the deployment's secret, presented as `?tkn=` on the WebSocket URL or as `Authorization: Bearer` |
| deployment token | the connection token that is the host itself |
| a person's token | a per-person secret `ahpd user token` mints; it opens the door and names nobody |
| `authenticate` | the protocol command that says who is on the other end |
| resource | the https identifier this host advertises for its own sign-in, which `authenticate` names |
| issuer | an authorization server whose tokens this host also accepts |
| trusted folders | a window's answer about the folders its sessions may load project files from |

## What each one answers

| | The deployment's token | A person's own token | `authenticate` |
| --- | --- | --- | --- |
| Where it is presented | `?tkn=` on the WebSocket URL, or a bearer header | the same, with the secret `ahpd user token` printed | the command, against the resource the host advertises |
| What it answers | whether a socket may exist at all | that, and nothing else | who is on the other end, for a socket that arrived as nobody |
| Identity | the host itself, when a directory is configured | nobody, unless the record sets `trustToken` | the person the directory or the issuer resolves the token to |
| How it is revoked | rotate the token, restart, everybody reconnects | `ahpd user rm`, and the next connection is refused | `ahpd user rm`, and the next command is refused |
| How many | one, shared | one per person | one per person |
| Expiry | none | none | `expiresIn`, honoured |

The deployment's token is root only when a directory is configured: with no `users` key there is nobody to be, so the token admits the socket and neither credential names anybody.

## The door

Loopback with no token needs no secret: anything reaching `127.0.0.1` is already on this machine. Binding anything else without one of the three token flags refuses to start, rather than putting a host on the network that anybody can drive.

```bash
ahpd --host 0.0.0.0 --connection-token-file ~/.ahpd/token   # written if absent, owner-readable
ahpd --host 0.0.0.0 --connection-token "$SECRET"
ahpd --host 0.0.0.0 --without-connection-token              # deliberately open
```

`--connection-token-file` writes a fresh secret, mode 0600, when the file is not there. Clients present the token as `?tkn=<secret>` on the WebSocket URL or as an `Authorization: Bearer <secret>` header. The query string is the one that always works, because a browser cannot set headers on a WebSocket handshake. A wrong token is refused with **401 at the handshake**, so it never reaches the host.

```bash
ahpc --host ws://192.168.1.10:9187 --token "$SECRET"
```

Only stdout says where the token came from, never what it is.

This is the *connection* token, which is about who may reach the host at all. With a user directory a person's own token reaches it too, and the deployment's token is the host itself. The token a client pushes with `authenticate` is a different thing again and is covered in [AHP.md](AHP.md#authentication); who the people are is [USERS.md](USERS.md).

## The deployment token

The deployment's token needs no credential. A socket on it is the host: every capability, including a scheme no role names, because the key to the door is the operator's own. It is the one thing `authenticate` cannot demote or revoke, and the one thing never asked to justify itself. Rotating the deployment's token is what locks somebody out of the door entirely, and that token is the host itself - decision [the door token is the host, and a person's own token is that person](../.project/decisions/the-door-token-is-the-host.md).

## A person's token

A person's own token opens the socket and names nobody, and the first gated command answers `-32007`, so the client signs in. That is the default because a token in a URL can end up in a log and a login does not - decision [a person signs in through `authenticate`, not through the connection token](../.project/decisions/a-person-signs-in-through-authenticate.md).

Two things opt out of it:

```json
{
  "trustToken": true,
  "users": [
    { "id": "normal", "roles": ["guest"], "token": "sha256:…", "trustToken": true }
  ]
}
```

`trustToken` at the top of the configuration trusts everybody's connection token; on a record it decides for that one person and wins over the host. Use it for a client that cannot complete a sign-in, such as a phone with only a URL to paste. A host that wants the token to be enough everywhere sets it once - decision [the door admits a socket and names nobody, and the deployment's token is still the host](../.project/decisions/the-door-is-a-door.md).

Removing a user **does not close their socket**, but the next command on it is refused `-32007`: the directory is read again for every command, so removal and a role change both take effect at once, with no reconnection - decision [a role is read on every command, not once at sign-in](../.project/decisions/a-role-is-read-on-every-command.md).

## `authenticate`

The command names a resource this host advertised and a token. The host's own sign-in resource is the one credential this host verifies itself, against its user directory; every other resource keeps the token unverified and spends it on that connection's sessions. An empty token takes the credential back, which the protocol names as revocation beside `expiresIn`. An unknown resource is `-32602`, and a token the directory does not know answers `-32007`.

The host advertises, on every agent, a record describing its sign-in: `resource`, the identifier a client names in `authenticate`; `resource_name`; `resource_documentation`; and `required`. There is no `authorization_servers` until an issuer is configured, because this host is not an authorization server. The daemon prints the identifier at startup on a `sign-in` line. A connection the host already treats as somebody - the deployment's own token, or a personal token that has signed in - is told `required: false` instead, and every other connection reads `true` - decisions [a connection that is already authorized is told the host's sign-in is not required](../.project/decisions/an-authorized-connection-is-told-sign-in-is-not-required.md) and [the host advertises only what is true about how to sign in](../.project/decisions/a-host-advertises-only-what-is-true.md).

A token pushed for a backend's own resource or an MCP server's is held per connection, unverified, and spent only on the sessions that connection asks for. An empty token withdraws it; what is already running keeps the credential it was started with. `expiresIn`, a positive integer of seconds, is kept beside the token, and `auth/required` with `reason: 'expired'` is sent to that connection when it runs out.

## An issuer

A host that is its own issuer mints every secret and prints it for a person to paste. A client that only acquires tokens through an OAuth provider cannot do anything with a pasted secret, so a deployment can name an authorization server instead:

```json
{ "users": "/home/me/.config/ahpd/users.json", "issuer": "github" }
```

or `--issuer github`, or `--issuer https://login.example.com` for an OpenID Connect issuer - decision [the issuer option names an OpenID Connect issuer by URL, with GitHub as a preset](../.project/decisions/the-issuer-option-takes-a-url-or-github.md). The record then carries it, which is the field left empty otherwise:

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

A client resolves a provider for that identifier, obtains a token, and pushes it through `authenticate` exactly as the protocol says. This host then asks the issuer who the token belongs to, and the answer is matched against a record's `id`: a GitHub login, or an OpenID Connect `sub`. The roles still come from the file, because the file is the only place that says who may do what - decision [an issuer answers for a subject, and the directory still decides what they may do](../.project/decisions/an-issuer-answers-for-a-subject.md).

```json
{
  "users": [
    { "id": "octocat", "roles": ["member"], "token": "" }
  ]
}
```

### An issuer per person

The `issuer` key is the **default**: a record that names one of its own uses that instead. So one host can take a GitHub login for one person and a token from a company identity provider for another, without a second daemon - decision [a record may name its own issuer, and the host's issuer is the default](../.project/decisions/a-record-may-name-its-own-issuer.md):

```json
{
  "users": [
    { "id": "octocat", "roles": ["member"], "token": "", "issuer": "github" },
    { "id": "ana", "roles": ["member"], "token": "", "issuer": "https://idp.example.com" },
    { "id": "sam", "roles": ["guest"], "token": "" }
  ]
}
```

`sam` names none, so he signs in through whatever the configuration's `issuer` is, or through a minted secret when there is none. A record's `issuer` is the same name the configuration takes: `github`, or an issuer URL this host may reach. A name that is neither is reported on stderr and never verifies, the way a grant that is not `<subject>:<verb>` is.

It can be set from the command line instead of by hand:

```bash
ahpd user add ana --role member --issuer github
ahpd user add sam --role guest                  # the configuration's default
```

`--issuer` on a record that already exists moves that person to that provider, and leaving it off never moves them to the default: `add` sets the roles, and the provider only when the flag names one. A name nothing can resolve is refused before anything is written.

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

The claim's values are **role names this file defines** or built-ins, and they are added to the roles on the record. The issuer never names a grant: a `groups` value of `operators` reaches the grants above because this file wrote them, and a value that names no role here is reported on stderr and dropped. An issuer that omits the claim contributes nothing, which is not a refusal - decision [a claim names the roles, and this file defines them](../.project/decisions/a-claim-names-the-roles-this-host-defines.md).

The two halves move on different clocks. The claim is read once, at sign-in, because asking again would mean keeping the token. The record's own roles are read on every command, so removing a person still lands at once and a change at the issuer lands the next time they sign in.

`ahpd user list` prints the claim so the file and the answer can be compared:

```
ana (guest) session:read automation:read sign-in https://idp.example.com rolesFrom=groups
```

The advertised record lists every provider any of this answers for, because that is the list a client resolves one from:

```json
{
  "resource": "https://127.0.0.1:9187/",
  "authorization_servers": ["https://github.com/login/oauth", "https://idp.example.com"],
  "scopes_supported": ["read:user", "openid"],
  "required": true
}
```

`scopes_supported` is the union, so a client that asks for all of them asks one provider for a scope it does not know. A client picks the provider it has and asks for what that one wants; the union is there because the field is flat.

Which provider minted a token is not something the token says, so a token that matched no minted secret is offered to the host's default first and then to each issuer a record names, in the order the file lists them. The first subject that names a record wins. A host with several issuers therefore shows a token to more than one of them, which is the cost of the feature rather than an accident.

### The issuer has to be reachable, and what counts as reachable

The host fetches `<issuer>/.well-known/openid-configuration`, reads `userinfo_endpoint` from it, and asks that endpoint with `Authorization: Bearer <token>`, taking `sub` as the subject. So the issuer must publish both, and an identity provider that does not is one this option cannot use. `github` needs no discovery: its endpoint and its subject field are fixed, and the subject is the login.

An issuer URL is accepted over **https anywhere**, and over plain **http only on loopback** - `127.0.0.1`, `::1` or `localhost`. A local issuer is common and nothing leaves the machine there; a remote one over http would put a bearer token in clear - decision [an issuer may be plain http on loopback, and nowhere else](../.project/decisions/an-issuer-may-be-plain-http-on-loopback.md). A remote issuer with a self-signed certificate needs its CA trusted, or `fetch` fails and every token reads as nobody: start the daemon with `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`.

### Trying it

Three ways, in the order they take to set up:

- **GitHub**, which needs no issuer to run: `"issuer": "github"`, then a person with the id of their GitHub login, and a token from GitHub with `read:user`. A stock VS Code resolves its own GitHub provider for it.
- **The dev issuer**, which verifies nothing and answers any token as its own subject: `node scripts/dev-issuer.mjs 9310`, then `--issuer http://127.0.0.1:9310`. `Bearer ana` answers `sub: ana`, so a record with id `ana` can sign in with the token `ana`. `Bearer ana|ops,eng` answers `groups: [ops, eng]` as well, which is a record's `rolesFrom` reading a claim.
- **A real identity provider**, named by its issuer URL.

Two run at once: the dev issuer is the default, and one record names GitHub instead, so a token from either signs in the person whose record says so:

```json
{
  "issuer": "http://127.0.0.1:9310",
  "users": [
    { "id": "ana", "roles": ["admin"], "token": "" },
    { "id": "octocat", "roles": ["guest"], "token": "", "issuer": "github" }
  ]
}
```

`ahpd user list` says where each record signs in, so the file and the answer can be compared without signing in:

```
ana (admin) *:* sign-in http://127.0.0.1:9310
octocat (guest) session:read automation:read sign-in github
```

An issuer adds a way in and takes nothing away, so configuring one does not close the local one. A person is challenged once, at the first command that needs a grant, and the deployment's own connection token is the host, so the operator is never challenged at all.

Three things worth knowing:

- A secret this host minted is checked first, and the issuer is asked only when nothing matched. A deployment can run both, and a person holding a minted secret never depends on the issuer being reachable.
- A token the issuer refuses and an issuer that cannot be reached both answer `-32007`. The host does not pretend to know which it was, and a client cannot tell either, so the advice is the same in both cases: sign in again.
- A record with no minted secret is a protocol credential and not a connection token. The door is decided before the socket exists, and the issuer is not asked there, so such a person pastes nothing and signs in through `authenticate`.

## Trusted folders

A window tells this host which folders it trusts in the root config, under `workspaceTrust`. The key is the one VS Code pushes from its own workspace-trust setting. It is read as an editor reads it: nothing pushed means no folder is trusted.

The value has two fields. `enabled: false` means the window has workspace trust switched off, so every folder it opens is trusted. Otherwise `trustedUris` lists the folders it trusts, and a folder is trusted when it is one of them or sits under one.

Pushing the key needs `trust:push`, which the `trust:write` group covers and the built-in `member` role holds. Trust decides what a session loads from its project. A folder this host was not told to trust loads none of the project's own settings, hooks or MCP servers. What loads them anyway is the agent's own question: see `honoursTrust` in [PLUGINS.md](PLUGINS.md).

The key is kept on the connection that pushed it, like `defaultShell` beside it. Two windows on one daemon each answer for their own sessions. Each answer covers every folder at once, which is why the grant is one - decisions [a folder is untrusted until a client has pushed `workspaceTrust` saying otherwise](../.project/decisions/a-folder-is-untrusted-until-a-client-says-otherwise.md) and [pushing `workspaceTrust` needs `trust:write`, and the `member` role has it](../.project/decisions/pushing-workspace-trust-needs-trust-write.md).

When a session moves to a folder the window has not vouched for, the host asks the window itself, with `vscode/requestWorkspaceTrust`. A window that says no, or that does not serve the method, means the move is refused with `Workspace trust was not granted for '<folder>'`. A yes is kept on that connection, so the next move into that folder is not asked again.

A worktree is trusted exactly when the repository it was cut from is, since the window has never opened it.

`globalAutoApproveEnabled` is the neighbouring key and the host's rather than a window's. It is a boolean, off by default, and turning it on runs every tool call in every session on this host without asking. It is not a per-connection key, so pushing it needs `config:write`, which only `admin` holds among the built-in roles.

## What is readable before signing in

The agent list, a session count, the root config, and every open terminal's URI, title and claim - including, when a session opened it, that session's and chat's URIs. Knowing a channel is not being able to drive it: a dispatch into any of them is refused unless the person signed in and their role covers it.

The root state is one per host, so it cannot be filtered wholesale without giving every connection its own sequence numbers - decision [a role refuses at the dispatch boundary, and never hides root state](../.project/decisions/a-role-refuses-at-the-dispatch-boundary.md) says why, and `protectedResources` is the reason it must be readable at all: it is what tells a client where to sign in. Two parts are overlaid for the one connection reading them, with no second sequence number: the `config` values that connection pushed, and the `required` field on the host's own sign-in resource when the connection is root or signed in.

## Configuration keys

- `host` - the address the daemon binds. Default `127.0.0.1`. `0.0.0.0` accepts from other machines and needs a token.
- `port` - the port the daemon binds. Default `9187`. `0` picks a free one.
- `connectionToken` - require this secret on every connection. No default.
- `connectionTokenFile` - require the secret in this file, writing a fresh one if it is not there. No default.
- `withoutConnectionToken` - `true` accepts any connection. Off by default. Refused beside either token key.
- `users` - the user directory file. Absent, there are no people: every gate this host has is inert and the connection token is the whole of who may be here.
- `resource` - the https identifier this host advertises for its own sign-in. Default: derived from `host` and `port`.
- `issuer` - an authorization server whose tokens this host also accepts: `github`, or an OpenID Connect issuer URL this host may reach. Default: none, so only secrets this host minted are checked.
- `trustToken` - `true` trusts every person's connection token as their authorization. Off by default. A record's own `trustToken` overrides it.

A relative `users`, `connectionTokenFile`, `worktreesRoot` or `paths` entry is resolved against the directory of the configuration file that set it, not the working directory.

## Commands

```
ahpd user list              who is in the user file
ahpd user add <id>          add a person, with --role and --issuer
ahpd user token <id>        mint their credential, shown once; --url prints
                            the whole ws:// URL a client can be given
ahpd user rm <id>           take a person out of it
ahpd user member <id> ...   what their work may be charged to
ahpd user primary <id> ...  where work naming no team and project lands
```

`ahpd user add <id>` takes `--role` once per role, `--issuer <name>` for a provider of their own, `--membership <team[:project]>` and `--primary <team[:project]>`. With no `--role` it adds the person as `guest`. `ahpd user token <id>` prints the bare secret by default and the whole `ws://…?tkn=…` URL with `--url`; the warning that it is shown once goes to stderr. A removal asks before it runs; a script with no terminal is refused until it passes `--yes`.

Who is in the file, the roles and teams, and the resource schemes over them are [USERS.md](USERS.md).

## Grants

| Command | Needs |
| --- | --- |
| `user list` | `user:read`, `role:read` |
| `user add`, `user rm`, `user token`, `user member` | `user:write` |
| `user primary` | their own; `user:write` for somebody else's |
| `team list` | `team:read` |
| `team add`, `team rm` | `team:write` |

`user:write` manages people at or below the caller: `user add` refuses a role, and `user add`, `user token` and `user rm` refuse a person, that holds a grant the caller does not hold, so the grant is not `admin` under another name - decision [a user command gives, mints for and removes only what its caller holds](../.project/decisions/a-caller-gives-only-the-grants-it-holds.md).

Over HTTP the deployment's token is root, and a person's token is verified the way `authenticate` verifies one. Installing, removing, updating or turning a plugin on or off, changing its options, and `restart` are the deployment's token only, and no grant a person may hold confers them - decision [installing a plugin over HTTP is root only](../.project/decisions/installing-a-plugin-over-http-is-root-only.md).

## See also

- [AHP.md](AHP.md#authentication) - the `authenticate` and `auth/required` rows, and what a pushed token does.
- [USERS.md](USERS.md) - the people, the shapes a deployment can take, the roles and the people schemes.
- [DAEMON.md](DAEMON.md#an-http-api-for-the-commands-the-terminal-runs) - the same commands over `/api`, under the same grants.
