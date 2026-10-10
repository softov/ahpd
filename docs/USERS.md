# Users and permissions

`ahpd` has one secret by default: the connection token. Everybody who holds it is the same caller, and the host has no idea who anybody is.

A **user directory** changes that. It is the file naming the people who may use this host, the roles they hold and what their work may be charged to. The door, the tokens, `authenticate`, the issuer and what a client may read before signing in are [AUTHENTICATION.md](AUTHENTICATION.md); this page is the directory itself.

Nothing here is on unless a file is configured: a daemon with no `users` key behaves exactly as it did before this existed.

## The door and the authorization

What the connection token, a person's own token, `authenticate` and the deployment's token each answer, and how each is revoked, is [AUTHENTICATION.md](AUTHENTICATION.md#the-door).

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

There is no `authorization_servers` until an `issuer` is configured. That field is a list of RFC 8414 issuer identifiers, and this host is not an authorization server, so with nothing configured it is left out rather than filled with something that is not one: a client matches each entry against the authentication providers it has, so an entry on `github.com` can resolve GitHub's provider and send a person to sign in somewhere that knows nothing about this host. The field is optional for exactly this reason. Configured, it carries the issuers this host answers for - [AUTHENTICATION.md](AUTHENTICATION.md#an-issuer).

`required` is true because every command but the handshake and `authenticate`
answers `-32007` until a person is known. The daemon prints the identifier at
startup on a `sign-in` line, so an operator can see what a client will be told
without reading root state.

A connection the host already treats as somebody is told `required: false`
instead, and that is the deployment's own connection token - root - or a
personal token that has signed in. A client reads the field to decide whether
to prompt, and prompting a connection that would be served anyway is a client
that never sends `createSession`, which is what a root connection on VS Code
met with an issuer that was not running. The field is rewritten per connection
as the root state is delivered: in the snapshot, in the live
`root/agentsChanged` and in a reconnect replay. Every other connection still
reads `true`, and a backend's own resources and GitHub's are listed as they
are.

## An issuer, when a client needs one

Naming an authorization server instead of minting secrets - the `issuer` key, a record's issuer of its own, `rolesFrom`, and what counts as reachable - is [AUTHENTICATION.md](AUTHENTICATION.md#an-issuer).

## Roles

A grant is a **subject** and an **operation**: `session:list`, `file:put`,
`container:connect`. The operation comes last, which is the convention every
scope list uses - `contents:read` in GitHub's app permissions, `channels:read` in
Slack's, `s3:GetObject` in IAM.

`read` and `write` are the two **groups** a subject's operations fall into, and
they are never an operation of their own. So `session:read` is the whole of what
may be done to a session and `session:list` is listing them; `user:get` is one
person's record and `user:read` is every one of them. A subject has no
operation called `read` or `write`, and the two words in that position mean the
group every time - decision
`a-grant-names-an-operation-and-read-and-write-are-its-groups`.

The host advertises every subject a grant may name in `_meta['ahpd.grants']` on
the handshake and on the root state, so a client reads the operations from the
wire rather than from this page. That map holds the ten the host decides and,
beside them, every scheme this host serves - `user`, `team`, `project`, `role`,
`policy`, `usage` and any plugin's - each under its own name, with the
operations its provider implements and the groups those fall into. A client
drawing a role editor reads that one key and has every subject there is.

The subjects the host decides are these ten:

| Subject | Read group | Write group | What they cover |
| --- | --- | --- | --- |
| `session` | `list`, `state` | `create`, `dispose`, `rename`, `configure`, `folders`, `attach`, `mark`, `review`, `changes`, `worktree`, `artifacts` | Agent sessions: seeing them, starting them and changing them |
| `chat` | `turns` | `create`, `fork`, `dispose`, `move`, `send`, `cancel`, `answer`, `tool`, `draft`, `folders`, `mark`, `truncate` | The conversations inside a session. A `session:` grant covers them too |
| `terminal` | `output` | `create`, `dispose`, `input`, `resize`, `claim`, `rename`, `clear` | Shells on this machine |
| `automation` | `list` | `create`, `update`, `remove`, `run`, `cancel` | Agent runs that start on a schedule or a trigger |
| `file` | `get`, `list`, `resolve`, `watch` | `put`, `delete`, `mkdir`, `move`, `copy`, `request` | Files and other resources on this host. Every other scheme has the same operations under its own name |
| `config` | `settings` | `change` | This host's settings |
| `diagnostics` | `logs`, `network`, `fetch` | - | Logs and network details for troubleshooting |
| `container` | - | `connect`, `disconnect`, `relay`, `stop`, `remove` | Connecting to dev containers, and stopping or removing one |
| `proxy` | `models` | `call` | The model proxy under `/v1` ([PROXY.md](PROXY.md)). `proxy:call` calls a model, which spends this host's provider keys; `proxy:models` lists the model names |
| `trust` | - | `push` | Pushing a window's answer about a folder to this host, which decides what that window's sessions load from the project. A window answers for every folder at once ([Trusted folders](AUTHENTICATION.md#trusted-folders)) |

`proxy` and `trust` have no scheme of their own: a client never reads a
`proxy://` or a `trust://` URI, so nothing asks for a resource operation on
either. The gate behind them is on two other surfaces - the root config, where
a push asks for `trust:push`, and the proxy's `/v1`, where a call asks for
`proxy:call` and a model list asks for `proxy:models`. The gate asks the
operation, and each subject's group in the table above covers it.

The rest are the people schemes and any plugin's, which share the `file`
operations under their own name:

| Subject | What they cover |
| --- | --- |
| `user` | Add, remove and mint for people with `put`, and only for a role or a person whose grants the caller already holds; re-adding a person counts the roles they hold as well as the ones given. The bound counts the roles in the users file, so a role an issuer's claim grants at sign-in is not among them. `list` answers `user list`, `get` a person's own `user://<id>` record without any grant at all |
| `team` | Teams people belong to. `list` answers `team list`; `put` adds and titles one, `delete` removes it |
| `project` | The same for the projects, spelled after a membership's colon |
| `role` | The roles this install defines. `user list` asks for `role:list` as well, because its answer prints what each person's roles resolve to; there is no `role` command of its own yet |
| `usage` | What each pool has been charged, and the records charged to it, read through the `usage:` scheme. There is no write half: records are written by the meters that charge them |
| `policy` | The rows saying who may use which agent, model and computer, read through the `policy:` scheme. Read lists and reads; write makes, edits and takes away a row. Whether any of it binds is the daemon's `policies.check` switch, not this grant |
| a plugin's scheme | That provider's resources, exactly as before |

`*` stands in either position: `*:read` is every subject's read, `session:*` is
every operation on sessions, `*:*` is everything.

A role written before this table names a verb and keeps its meaning, because
every verb that was a group still is one: `session:read` held everything in
`session`'s read group and still does, and `file:write` still holds the whole
write group. What changed is the other direction. A grant that was never a verb
and is not an operation of its subject - `computer:edit`, say - is no longer
refused as malformed by any host that decides that subject; it is simply a grant
that matches nothing, because the table above is where an operation comes from.
A grant naming no subject the host decides, such as one on a plugin's scheme, is
the scheme's own to say what its operations are and any word is kept.

A person reads their own usage without `usage:read` at all: their `user:<id>`
pool, and the `team:` and `project:` pools of the teams and projects they are a
member of. Every other pool is refused until a role names the grant.

| Role | Has |
| --- | --- |
| `admin` | `*:*` |
| `member` | `file:read`, `file:write`, `session:read`, `session:write`, `terminal:read`, `terminal:write`, `proxy:read`, `proxy:write`, `trust:write` |
| `guest` | `session:read`, `automation:read` |

`guest` is the default for `ahpd user add` with no `--role`, and it is the one
worth looking at twice: it lists the sessions and the automations and can do
nothing about either - no file, no shell, no session of its own, no automation
run.

A plugin's scheme is never conferred by a plain subject. `file:put` is not
`computer:put`; a role reaches a scheme by naming it (`computer:put`) or by
naming a wildcard that covers it (`*:*`). The computer is the worked example:
reading a machine is `computer:get` and making or destroying one is
`computer:put`, so a person who may save a file may not, by that alone, start
a container - see [COMPUTER.md](COMPUTER.md). That is deliberate: a role that may
save your files may not, by that alone, start a container on your host. The
refusal tells you what to add - the `-32009` message is
`<person> may not computer:put here` - so the way to discover a subject is to
try it once and read the answer.

Define your own in the same file; a file role overrides a built-in of the same
name. A role of operations sits beside one of groups, and the two mix:

```json
{
  "roles": {
    "viewer": ["*:read"],
    "editor": ["file:read", "file:put", "session:write"],
    "senders": ["session:read", "chat:send", "file:get"]
  },
  "users": [
    { "id": "ana", "roles": ["admin"], "token": "sha256:…" },
    { "id": "sam", "roles": ["viewer"], "token": "sha256:…" }
  ]
}
```

A role name that is neither built in nor defined in the file is refused when the
person is added, so a typo is a refusal rather than a person who may do nothing.
A grant that is not `<subject>:<operation>` is reported when the file is read and
dropped: an operation is one the subject above has, one of the two group names,
or `*`. A grant naming a subject the host does not decide is left alone, because
the scheme behind it is the only thing that knows what its operations are. A file
that is malformed is read as nobody - it fails closed - and it is never written
over.

A `users:read` or `users:write` written before the split is read as `user:read`
or `user:write` and nothing more, and the daemon says so once at start for each
role it read that way. An old grant used to cover people, teams, projects and
roles together; it does not widen to the three subjects it never named, so a role
that edited teams through `users:write` needs `team:write` added to it.

`ahpd user list` prints the roles, the grants they resolved to, whether the door
already identifies the record or the person still has to sign in, and the issuer
when their credential comes from one:

```
normal (guest) session:read automation:read sign-in http://127.0.0.1:9310
sam (member) file:read file:write session:read session:write terminal:read terminal:write proxy:read proxy:write trusted
```

## People as resources

What a scheme is, and which operation of it each resource method asks for, is [RESOURCES.md](RESOURCES.md). This is what these four schemes carry.

With a directory configured the host serves four schemes of its own over it, the
same way it serves `computer:`: a client lists, creates, edits and removes
people, teams, projects and roles through the same resource calls it uses for
computers.

| Scheme | A record is | A body carries |
| --- | --- | --- |
| `user://<id>` | One person's record | `roles`, `issuer`, `rolesFrom`, `memberships`, `primary` |
| `team://<id>` | A team and its title | `title` |
| `project://<id>` | A project and its title | `title` |
| `role://<id>` | A role's grants, which are the whole of it | `grants` |

The root lists what the file holds, a read answers the record as JSON, and a
write to `<scheme>://<id>` makes it or edits it; `write` covers the removal as
well. A record is written whole: a field a body does not name is the one the
record already had, so a client that reads a record and writes it back has
changed nothing. `null` is the one value that takes a field away rather than
setting it, and a person's `issuer`, `rolesFrom` and `primary` are the three
that answer to it, each named on its own. A blank string is not named, so it
leaves the record as it found it. A removal is refused while something still
names it - a membership naming a team, a record holding a role - and it says
who, which is the refusal `ahpd team rm` makes.

No answer carries a credential. The hash is in the file and the secret behind it
was shown once by `ahpd user token`, and a person's record here is everything
`ahpd user list` prints, which is not their token.

Each scheme is advertised on the handshake under `ahpd.resourceProviders`, with
its operations and the form a create is drawn from, so a client can draw the
screen before it has asked for anything. A host with no users directory serves
none of the four.

Those operations are the grant's words and not the provider's method names: a
provider's `read` is advertised as `get` and its `write` as `put`, so the entry
for `team` reads `"operations": ["get", "list", "resolve", "put", "delete"]` and
those are the words a role is written in. The groups those belong to are on the
scheme's own entry in `ahpd.grants`, beside this key on the same handshake:
`team` carries `get`, `list` and `resolve` under `read`, and `put` and `delete`
under `write`.

The grant for a scheme is the subject of its own name: `team:list` lists teams,
`team:put` makes and titles them and `team:delete` takes them away, and none of
the three reaches anybody's record. The one exception is a person's own
`user://<id>`, which they may read with no grant at all - a client showing
somebody their own account has to be able to - while listing people and reading
anybody else's still needs `user:list` or `user:get`.

That exception needs an id, so a client is told which one it is.
`_meta['ahpd.principal']` is the key, and it is spelled in two places: on the
`initialize` handshake, and in the `_meta` of the root state snapshot.
The value is `user:<id>` for a person and `root:<host>` for the deployment's own
token, which is a typed reference like any other rather than the absence of one.
Where there is nobody to name the key is absent, not empty: that is every host
with no users directory, and every connection on one that has not signed in.
A client that signs in after connecting is told nothing at the sign-in - the
protocol declares that result empty - so it takes the root state snapshot again
and reads the key there.
A sign-out (`authenticate` with an empty token) and an expiry
(`auth/required`, `reason: 'expired'`) clear it the same way, so the next
snapshot the client takes carries no key at all.
Everything else about that person is read from `user://<id>`, which is the only
place a record like this is served from.

## Policies as resources

What a scheme is, and which operation of it each resource method asks for, is [RESOURCES.md](RESOURCES.md). This is what this scheme carries.

A host with a policies store serves one more scheme of its own, the same way it
serves `computer:`: a client lists, edits and removes policies through the same
resource calls it uses for computers, under `policy:read` and `policy:write`.

| Scheme | A record is | A body carries |
| --- | --- | --- |
| `policy://<id>` | One policy row, and the id is the address | `scope`, `kind`, `effect`, `match`, `limits`, `pool`, `cap`, `from`, `until` |

The root lists every row, a read answers the row as JSON, and a write to
`policy://<id>` makes it or edits it; `createOnly` refuses one that is already
there, and `resourceDelete` takes it away. A row is written whole: a field a
body does not name is the one the row already had, so a client that reads a row
and writes it back has changed nothing. The body is the whole rule body, checked
the same way whichever door it came through - a value type the kind does not
take, a limit counted in a measure the kind does not have, and a `from` after its
`until` are all refused by name.

A store is not a directory, so none of this depends on a users file: a host with
policies and no directory still serves `policy:`, and a role is the only thing
that decides who may read or write it. What a row decides is another question,
answered in [POLICY.md](POLICY.md).

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
automation needs `automation:write`, and anything else needs `file:read`.
`ahp-root://` is read with the action: `root/configChanged` that only sets your
own keys (`defaultShell`) needs a sign-in and no grant, and one that pushes
`workspaceTrust` needs `trust:push`, which the `trust:write` group covers. Any
other key, or a replacement of the whole config, needs `config:write`, which
only `admin` has among the built-in roles.

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

Every client watching the root still gets the action, on the same sequence
number, but only the client that sent it sees `defaultShell` in it. The others
get it without that key, or with their own shell when the action replaces the
whole config. A replay after reconnecting reads the same way.

The absent `request` is the point: a grant would resolve the first, and nothing
resolves the second, so a client that reads the field correctly stops instead of
retrying. A VS Code window shows a read-only role as a `NoPermissions` dialog
with nothing to click, which is correct behaviour for that person and the reason
roles are configuration rather than a default.

## Trusted folders

Which folders a window vouches for, what a session loads from one it has not, and `globalAutoApproveEnabled` are [AUTHENTICATION.md](AUTHENTICATION.md#trusted-folders).

## What is readable before signing in

What a connection may read before it signs in, and the two parts overlaid on the root state for the one connection reading them, are [AUTHENTICATION.md](AUTHENTICATION.md#what-is-readable-before-signing-in).

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
