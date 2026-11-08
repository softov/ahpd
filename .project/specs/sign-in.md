---
title: Sign-in
status: current
covers:
  - packages/sdk/src/access/users.ts
  - packages/sdk/src/access/issuers.ts
  - packages/sdk/src/listen.ts
  - packages/sdk/src/host/handshake.ts
  - packages/sdk/src/host/auth.ts
  - packages/sdk/src/host/root.ts
  - packages/server/src/commands/run.ts
  - packages/server/src/config.ts
decisions:
  - decisions/a-persons-token-names-them-unless-the-issuer-is-required.md
refs:
  - "[code://packages/sdk/src/listen.ts#L102-L127](../../packages/sdk/src/listen.ts#L102-L127) - `identityOf`, what the door makes of a connection token"
  - "[code://packages/server/src/commands/run.ts#L555-L566](../../packages/server/src/commands/run.ts#L555-L566) - the daemon's `identify`, which names a person unless the record requires the issuer"
  - "[code://packages/server/src/commands/run.ts#L242-L248](../../packages/server/src/commands/run.ts#L242-L248) - `advertisedResource`, the https identifier of the sign-in resource"
  - "[code://packages/server/src/config.ts#L693-L702](../../packages/server/src/config.ts#L693-L702) - `signInIdentifier`, derived from the bind address and port"
  - "[code://packages/sdk/src/access/users.ts#L300-L345](../../packages/sdk/src/access/users.ts#L300-L345) - `DEFAULT_RESOURCE` and `signInRecord`"
  - "[code://packages/sdk/src/access/users.ts#L706-L714](../../packages/sdk/src/access/users.ts#L706-L714) - `advertised`, built again on every read"
  - "[code://packages/sdk/src/access/users.ts#L873-L919](../../packages/sdk/src/access/users.ts#L873-L919) - `verify`, local secrets first and then the issuers"
  - "[code://packages/sdk/src/access/issuers.ts#L90-L174](../../packages/sdk/src/access/issuers.ts#L90-L174) - the GitHub and OpenID Connect issuers, and the loopback rule"
  - "[code://packages/sdk/src/host/handshake.ts#L515-L619](../../packages/sdk/src/host/handshake.ts#L515-L619) - `authenticate`, sign-in and sign-out"
  - "[code://packages/sdk/src/host/handshake.ts#L346](../../packages/sdk/src/host/handshake.ts#L346) - `ahpd.principal` in the initialize result"
  - "[code://packages/sdk/src/host/root.ts#L536](../../packages/sdk/src/host/root.ts#L536) - `ahpd.principal` in the root state"
  - "[code://packages/sdk/src/host/auth.ts#L88-L116](../../packages/sdk/src/host/auth.ts#L88-L116) - `agentsFor` and `lent`"
  - git://d9d4f950^ - the deleted decisions this spec was written from: a-connection-is-told-who-it-is-on-initialize-and-in-root-state, a-connection-is-told-who-it-is, a-connection-token-may-carry-a-person, a-host-advertises-only-what-is-true, a-person-signs-in-through-authenticate, a-record-may-name-its-own-issuer, an-authorized-connection-is-told-sign-in-is-not-required, an-issuer-answers-for-a-subject, an-issuer-may-be-plain-http-on-loopback, the-door-token-is-the-host, the-issuer-option-takes-a-url-or-github, ahpd-keeps-its-own-user-directory
---

A host with a users file has two layers between a client and its commands.
The door decides whether a socket opens, from the connection token in the URL or the `Authorization` header.
The protocol's `authenticate` command decides who is on the socket, and the gate in [People, roles and grants](people-roles-and-grants.md) reads that person's roles.
The host advertises its own sign-in as a protected resource, and accepts its own minted secrets and the tokens of a configured issuer.
A connection is told who it is in the `ahpd.principal` key of `_meta`.
The code is in [`code://packages/sdk/src/listen.ts`](../../packages/sdk/src/listen.ts), [`code://packages/sdk/src/access/users.ts`](../../packages/sdk/src/access/users.ts) and [`code://packages/sdk/src/host/handshake.ts`](../../packages/sdk/src/host/handshake.ts).

## Scenarios

### The host keeps its own people

WHEN the config key `users` or the flag `--users` names a file
THEN the host reads its people from that file, and no outside identity provider is needed
AND `ahpd user` adds, removes and lists people, and mints a token that it shows once and stores only as a hash
AND a host with no users file has no people, and no gate in [People, roles and grants](people-roles-and-grants.md) applies.

### The deployment token is the host

WHEN a client connects with the deployment's own connection token
AND the host has a users file
THEN the connection is root, holds every grant and is never asked to sign in
AND a stdio connection is root in the same way, because only the process that started the host holds the pipes.

### A person's token names them

WHEN a client connects with a token that a record in the users file accepts
AND neither the record nor the host requires the issuer
THEN the socket opens as that person
AND the `initialize` result carries `ahpd.principal` in `_meta`, with no `authenticate`
AND a token the person minted names them the same way, with the grants it and they both hold.

### The host requires the issuer

WHEN a client connects with a token that a record accepts
AND the record's `requireIssuer` is `true`, or the record does not say and the host's `requireIssuer` is `true`
THEN the socket opens with no principal
AND every gated command answers `-32007` until the person signs in through `authenticate` with the issuer's token
AND the host default is off, and is set with the `requireIssuer` key or `--require-issuer`
AND the record's own `requireIssuer` wins over the host's.

### A token the door does not know

WHEN the host has a deployment token
AND a client connects with a token that is neither that token nor one the users file accepts
THEN the door refuses the socket
AND a host started with no deployment token opens every socket, and still names a person when a presented token is one a record accepts.

### A person signs in through authenticate

WHEN a client sends `authenticate` for the host's sign-in resource with a token
THEN the host verifies the token against the users file and answers `{}` when it names a person
AND the connection is that person from the next command on
AND a token that names nobody answers `-32007`, "That credential is not one this host knows", with the sign-in resource in the error data
AND a local token where the record requires the issuer answers `-32007`, "Sign in through your issuer", with the sign-in resource in the error data
AND an `expiresIn` ends the sign-in after that many seconds.

### A person signs out

WHEN a signed-in client sends `authenticate` for the sign-in resource with an empty token
THEN the connection has no principal again
AND a root connection that sends `authenticate` for the sign-in resource gets `{}`, and stays root.

### One client id is one person

WHEN a second person signs in under a client id that another person signed in under first
THEN the host answers `-32003` and asks the client to connect under its own id.
The reason: a published resource is routed to its client id.

### Verifying a token

WHEN the host verifies a token
THEN it first compares the token's SHA-256 hash with every record's minted secret, in constant time per record
AND with no local match, it asks the host's default issuer, then each issuer a record names, in the order of the file
AND each issuer is asked only about the records that sign in through it
AND the first subject that names one of those records is the person.

### An issuer answers for a subject

WHEN the issuer is `github`
THEN the host asks `https://api.github.com/user` with the token, and the subject is the `login` field
AND the issuer is advertised as `https://github.com/login/oauth` with the scope `read:user`
WHEN the issuer is a URL
THEN the host reads `userinfo_endpoint` from `/.well-known/openid-configuration` once, and the subject is `sub`
AND a discovery that fails is tried again at the next sign-in.

### An issuer URL is https, or plain http on loopback

WHEN the `issuer` option or a record's `issuer` names a URL
THEN an https URL is accepted anywhere
AND a plain http URL is accepted only on `127.0.0.1`, `[::1]` or `localhost`, and the discovered endpoint is held to the same rule
AND a daemon whose `issuer` option is neither `github` nor such a URL does not start.
The reason: a bearer token sent over plain http to another machine travels in clear.

### A record names its own issuer

WHEN a record in the users file names an `issuer`
THEN that person signs in through that issuer instead of the host's default
AND a record that names no issuer uses the default
AND an issuer name that is not valid is logged once, and that record can then sign in only with a minted secret.

### The host advertises only what is true

WHEN a client reads the host's sign-in resource
THEN its `resource` is the `--resource` URL, or `https://<host>:<port>/` from the bind address, with the machine name for a wildcard address
AND `required` is `true`, and `resource_documentation` links the users documentation
AND `authorization_servers` and `scopes_supported` are there only when some issuer is configured, as the union of all issuers
AND the record is built again on every read, so a new record issuer shows with no restart.
The library alone, with no address, falls back to the identifier `ahpd://users`.

### The host's sign-in is on no agent

WHEN a connection reads the agent list
THEN no agent lists the host's own sign-in resource
AND a command refused before somebody signs in answers `-32007` with the sign-in record in `data.resources`
AND a sign-in that runs out is `auth/required` on the root, `reason: 'expired'`, naming the identifier alone.
The reason: VS Code's host says its host-level sign-in only in the data of the request it refuses, and its expiry with the identifier alone.
A VS Code client asks for a token for every resource an agent lists.
See https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2634-L2642 and https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/missionControl/missionControlProtocolServer.ts#L217.

### A person's sign-in is never lent

WHEN the host looks for a token that a connected client lent for a resource
THEN it never answers the sign-in resource's token, so one person's sign-in cannot start another person's session.

### A connection is told who it is

WHEN a connection is a person or root on a host with a users file
THEN the `initialize` result carries `ahpd.principal` in `_meta`, as `user:<id>` or `root:<host>`
AND the root state carries the same key for that connection
AND a client that signs in after it connected reads its id from a new root snapshot
AND the key is absent for a connection that is nobody, and on a host with no users file.
