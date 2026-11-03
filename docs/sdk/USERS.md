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
   loopback, and a token per person. A person's own token names them at the
   door, and a person whose record requires the issuer signs in with
   `authenticate` against that issuer instead.
3. **No deployment token at all.** `--without-connection-token`, so a person's
   own token is the only secret and who may reach the port is the network's
   business. A token nobody recognises is then simply a socket that is nobody:
   it is admitted, it may read root state, and every command behind the gate
   answers `-32007`. `--host 0.0.0.0` with no token is this shape whether you
   meant it or not.

## Turning it on

The `users` key, the `--users` flag and the `ahpd user` commands are [server/USERS.md](../server/USERS.md#turn-it-on).

## The record the host advertises

The host advertises, on every agent, an RFC 9728 record describing its own
sign-in:

```json
{
  "resource": "https://127.0.0.1:9187/",
  "resource_name": "ahpd users",
  "resource_documentation": "https://github.com/softov/ahpd/blob/main/docs/sdk/USERS.md",
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
A grant names a subject and one of its operations, and read and write are groups of those operations.

Every operation is in one of the two groups, with one exception: `plugin:install` is in neither. Installing, removing or writing a plugin runs code with the daemon's permissions, so a role must name that grant rather than receive it with `plugin:write`; only a grant naming `plugin:install`, `plugin:*` or `*:*` holds it.

The host advertises every subject a grant may name in `_meta['ahpd.grants']` on
the handshake and on the root state, so a client reads the operations from the
wire rather than from this page. That map holds the eighteen the host decides and,
beside them, every scheme this host serves - `user`, `team`, `project`, `role`,
`policy`, `usage` and any plugin's - each under its own name, with the
operations its provider implements and the groups those fall into. A client
drawing a role editor reads that one key and has every subject there is.

The subjects the host decides are these eighteen:

| Subject | Read group | Write group | What they cover |
| --- | --- | --- | --- |
| `session` | `list`, `state` | `create`, `dispose`, `rename`, `configure`, `folders`, `attach`, `mark`, `review`, `changes`, `worktree`, `artifacts`, `trust` | Agent sessions: seeing them, starting them and changing them. `session:trust` lets a plugin ask for its own folder to be trusted |
| `chat` | `turns` | `create`, `fork`, `dispose`, `move`, `send`, `cancel`, `answer`, `tool`, `draft`, `folders`, `mark`, `truncate` | The conversations inside a session. A `session:` grant covers them too |
| `terminal` | `output` | `create`, `dispose`, `input`, `resize`, `claim`, `rename`, `clear` | Shells on this machine |
| `automation` | `list` | `create`, `update`, `remove`, `run`, `cancel` | Agent runs that start on a schedule or a trigger |
| `file` | `get`, `list`, `resolve`, `watch` | `put`, `delete`, `mkdir`, `move`, `copy`, `request` | Files and other resources on this host. Every other scheme has the same operations under its own name |
| `config` | `settings` | `change` | This host's settings |
| `plugin` | `list` | `enable`, `disable`, `options`, `apply`, `reload` | The plugins the configuration names: listing them, turning them on and off, editing their options, and applying or reloading a running one. `plugin:install` installs, removes or writes a plugin and is in neither group, so `plugin:write` does not hold it |
| `client` | - | - | The clients this host is serving, and the connection each one holds. `client:read` lists them and `client:drop` closes a connection; `drop` is in neither group, so a role must name it |
| `tunnel` | - | `put`, `delete` | The tunnels this host keeps, and the operations each one takes. `tunnel:read` draws them, and `put` and `delete` are in the `write` group |
| `connector` | `list`, `all` | `put`, `remove`, `host` | The adapters plugins register, and the connectors made from them. `list` reads the caller's own connectors, their teams' and the host's; `all` reads every connector; `host` lets a put or a remove change a connector owned by `host` |
| `agent` | `list`, `all` | `put`, `remove`, `host` | The engines plugins register, and the agents made from records of them. `list` reads the caller's own agents, their teams' and the host's; `all` reads every agent and lets a remove take any of them, whoever owns it; `host` lets a put or a remove change an agent owned by `host` |
| `diagnostics` | `logs`, `network`, `fetch` | - | Logs and network details for troubleshooting |
| `container` | - | `connect`, `disconnect`, `relay`, `stop`, `remove` | Connecting to dev containers, and stopping or removing one |
| `node` | `list` | `add`, `remove` | The hosts that joined this one. `node:read` lists them; `node:write` adds a node and mints its token, which is shown once, and takes one away, which refuses its token and drops its connection |
| `proxy` | `models` | `call` | The model proxy under `/v1` ([PROXY.md](../server/PROXY.md)). `proxy:call` calls a model, which spends this host's provider keys; `proxy:models` lists the model names |
| `mcp` | - | `call` | Running the host's tools from a person's MCP client at `/mcp` ([MCP.md](../server/MCP.md)). `mcp:call` is what the door asks; each tool checks its own grants again |
| `trust` | - | `push` | Pushing the host's answer about the folders sessions load their projects from, which a window sends. A push answers for every folder at once ([Trusted folders](AUTHENTICATION.md#trusted-folders)) |
| `account` | `status` | - | The account each agent's harness is signed in as, published on the root config under `vscode.codexAccount` for Codex and `ahpd.<provider>Account` for the rest. The email is the operator's own, so a connection that does not hold `account:read` is shown no account value at all ([Agent accounts](AUTHENTICATION.md#agent-accounts)) |

`proxy`, `mcp` and `trust` have no scheme of their own: a client never reads a
`proxy://`, an `mcp://` or a `trust://` URI, so nothing asks for a resource
operation on any of them. The gate behind them is on other surfaces - the root
config, where a push asks for `trust:push`, the proxy's `/v1`, where a call
asks for `proxy:call` and a model list asks for `proxy:models`, and `/mcp`,
where a call asks for `mcp:call`. The gate asks the operation, and each
subject's group in the table above covers it.

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
| `member` | `file:read`, `file:write`, `session:read`, `session:write`, `terminal:read`, `terminal:write`, `proxy:read`, `proxy:write`, `mcp:call`, `trust:write` |
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
a container - see [COMPUTERS.md](../plugins/COMPUTERS.md). That is deliberate: a role that may
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

## People as channels and commands

Each of the four schemes is also a channel that holds every record a reader may
read, and two commands that change one. The resource schemes stay: a channel is
how a client keeps a list current without asking again, and a command is the
same write with typed params.

| Channel | Read grant | Commands | Command grants |
| --- | --- | --- | --- |
| `x-ahpd-users://` | `user:read` | `x-ahpd/users/put`, `x-ahpd/users/remove` | `user:put`, `user:delete` |
| `x-ahpd-teams://` | `team:read` | `x-ahpd/teams/put`, `x-ahpd/teams/remove` | `team:put`, `team:delete` |
| `x-ahpd-projects://` | `project:read` | `x-ahpd/projects/put`, `x-ahpd/projects/remove` | `project:put`, `project:delete` |
| `x-ahpd-roles://` | `role:read` | `x-ahpd/roles/put`, `x-ahpd/roles/remove` | `role:put`, `role:delete` |

A subscribe answers `{ records }`, one `{ id, record }` for each record the
reader may read, and the record is what a `resourceRead` of `<scheme>://<id>`
answers:

```json
{ "records": [{ "id": "backend", "record": { "id": "backend", "title": "Back end" } }] }
```

Three actions follow it, each sent only to the clients it concerns:
`x-ahpd-teams/added` and `x-ahpd-teams/changed` carry `{ id, record }`, and
`x-ahpd-teams/removed` carries `{ id }`. A write through the scheme, a command,
and an edit to the users file on disk each reach a subscriber:

```json
{ "type": "x-ahpd-teams/added", "id": "web", "record": { "id": "web" } }
```

The own-record rule holds here too. A person without `user:read` may subscribe
to `x-ahpd-users://`, and the list holds only their own record; anybody else's
is never sent to them. A person who loses a read grant is sent `removed` for
each record they no longer may read. On every other channel a reader without
the grant is refused the subscribe.

`put` takes `{ id, record, createOnly? }` and `remove` takes `{ id }`. Both go
through the rules a resource write and a removal go through, with the same
refusal sentences, and answer `{}`. An id with a `/` or a `?` in it is refused,
because no address could name it. Each command is listed on the handshake under
`_meta['ahpd.methods']` with the grant it needs.

## Tokens of their own

A person signs in with their full token, or through an issuer, and mints
tokens of their own over AHP. Each token may be limited to some of the
person's grants, and each is revoked without touching the others.

| Command | Params | Answers |
| --- | --- | --- |
| `x-ahpd/tokens/mint` | `user?`, `label?`, `grants?`, `expires?`, `scope?`, `meta?` | the token, with its `secret` |
| `x-ahpd/tokens/list` | `user?` | the tokens, without their hashes |
| `x-ahpd/tokens/revoke` | `id`, `user?` | `{}` |

Each needs `user:write`. A reader without it is let in by the method's
`authorize` for their own tokens, as the usage commands let a reader read
their own pools. `user` names somebody else: it needs `user:write` and is
refused for a grant that person holds and the reader does not. A root
connection has no reader, so it has to name a person.

The mint's `grants` is a list of grants the person holds now. Without one,
the token holds every grant its person does, read at each check. `expires`
is epoch milliseconds in the future. Without it the token does not expire.
`scope` is a team or a team and project the person is in now, and the token's
calls are charged to it, so a call naming another scope is refused. `meta` is
a map of names to values the key keeps about itself, such as
`{ "env": "prod" }`: a name is 1 to 64 characters of letters, digits, `_`, `.`
and `-`, and a value is at most 256 characters with no comma and no line
break. A call made with the key writes these on its usage record, and adds the
entries of its `X-AHP-Meta` header: a name the key holds keeps the key's value.
The answer carries the `secret` once, and the directory keeps only its
hash. The list answers the same records without a hash or a secret.

A reader that signed in with a minted token is refused all three with
`-32009` and `A minted token cannot manage tokens; sign in as yourself.`
Only the person's full sign-in manages tokens. The token's owner and the
grants it holds are read on every call, so a revoke or a grant taken from
the person is in force on the next one.

A directory that keeps no tokens refuses with a sentence saying this host
keeps none. The three are listed on the handshake under
`_meta['ahpd.methods']` with `user:write`.

## Who a connection is

A client asks the host who its connection is with `x-ahpd/me`. It takes no
params and answers one `Me` object. The grant is `user:get`, and the method's
`authorize` lets in every reader without it, a minted token too, because the
answer is only about the caller. A host with no users file serves no
`x-ahpd/me`.

| Command | Params | Answers |
| --- | --- | --- |
| `x-ahpd/me` | none | The `Me` of the caller |

| Field | Holds |
| --- | --- |
| `principal` | Whose work the connection's work is: `user:<id>`, `plugin:<name>` or `root:<host>` |
| `kind` | `user`, `plugin` or `root` |
| `id` | The id on the record; absent for root |
| `roles` | The record's roles and the roles the sign-in added |
| `rolesFromSignIn` | The roles the sign-in added alone, read from the claim `rolesFrom` names |
| `grants` | What the connection may do now |
| `token` | The id of the minted token the connection signed in with, when it was one |
| `pools` | The usage pools the connection's work is charged to |
| `memberships` | The teams and projects the person's work may be charged to |
| `primary` | The membership that work naming no scope is charged to |
| `issuer` | The issuer the record names, as written |
| `rolesFrom` | The claim the record reads roles from, as written |

A minted token's `grants` is narrowed to the grants the token holds, as every
check is. Root gets `roles` and `rolesFromSignIn` empty, `grants` as
`['*:*']`, and `pools` as its own `root:<host>`. `*:*` is the wildcard and not
the list of every grant. A plugin's own connection gets `roles` and
`rolesFromSignIn` empty, `grants` as its configuration entry's `grants`, and
`pools` as its own `plugin:<name>`. A connection that names nobody is refused with
`-32007`. The command is listed on the handshake under `_meta['ahpd.methods']`
with `user:get`.

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
`ahp-root://` is read with the action: `root/configChanged` that pushes only
`workspaceTrust` needs `trust:push`, which the `trust:write` group covers. Any
other key, or a replacement of the whole config, needs `config:write`, which
only `admin` has among the built-in roles: every key is one value for the whole
host.

That half is not optional. Root state names every open terminal's URI, and
`terminal/input` writes to a shell, so a dispatch nobody checked is a command
anybody can run.

`defaultShell` names the binary a client's terminal opens. It is one value for
the whole host, which the last push sets, so pushing it needs `config:write`
like every other key.

The paths with no connection in hand take the daemon's own shell, `$SHELL` and
then `/bin/sh`, or PowerShell on Windows, and not the pushed one: a `!command`
typed in a chat, and the factory a backend opens a terminal with during a tool
call. That is deliberate. It costs an agent's terminal the shell you chose in
your client, and it closes the path where writing a file and naming it here
would have made the next tool call in anybody's session run it.

Every client watching the root gets the action whole, on the same sequence
number, and a replay after reconnecting reads the same way.

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
from `ahpd user token <id> --url` reaches the socket. The token in it names
that person at the door, so the window is connected as them, and a deployment
that requires the issuer moves it back to a sign-in through the provider it
can resolve.

An issuer is what lets a client acquire a credential through its own OAuth flow
rather than being handed one, and it is configured with `issuer`. With `github`
in the configuration a stock client resolves its GitHub provider and signs in
with no extension; an enterprise names its own OpenID Connect issuer instead.
Plan 07's research file records what the reference client does with the field
and why it could not carry a pasted secret.
