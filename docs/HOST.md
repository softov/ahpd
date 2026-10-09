# The host

A **host** is what a client connects to: one root resource, the sessions running under it, the automations it holds and the resources it serves. One `ahpd` process runs one host, reachable over a WebSocket, over stdin and stdout inside a container, or over an HTTP API.

The process, its verbs and its flags are [DAEMON.md](DAEMON.md). This page is the host itself: what it announces, what it serves, and every setting it reads.

Terms, one line each:

| Term | |
| --- | --- |
| the host | the thing a connection is accepted by, and the name for everything below it |
| the root resource | the channel `ahp-root://`, which every client subscribes to |
| root state | the snapshot that channel answers: `agents`, `activeSessions`, `terminals` and `config` |
| root config | the keys a *client* pushes to `ahp-root://` with `root/configChanged` |
| a scheme | the part of a resource URI before the colon - `file`, `user`, `usage`, or a plugin's |
| a grant | `<subject>:<operation>`, one act on one kind of thing - [USERS.md](USERS.md) |

## The root resource

`ahp-root://` is the channel a client subscribes to before it knows anything else. Its state says what this host is:

| Field | What it says |
| --- | --- |
| `agents` | Every backend, as `providers` - see below |
| `activeSessions` | A number: how many sessions this host is running, not a list |
| `terminals` | Every open terminal's `TerminalInfo`, absent when none is open |
| `config` | The schema and the values of root config - see [Root config](#root-config) |

`_meta` carries three things beside them: `ahpd.resourceProviders`, the schemes this host serves; `ahpd.grants`, every subject a grant may name; and `ahpd.restartNeeded`, present only when a configuration change is waiting for a restart. `ahpd.principal` is there for a connection that has already signed in, saying who it is - the same statement the handshake makes, so a client that subscribes later reads what a client that connected earlier was told.

`ahpd.resourceProviders` is advertised in the handshake as well as in every root state, because a client needs it before it can ask for anything - decision [A resource scheme is advertised in `_meta`, and a client reads it there](../.project/decisions/a-resource-scheme-is-advertised-in-meta.md).

The root channel is also where a client's own reads are served, whatever they are about: `listSessions`, the resource calls, `authenticate`, `createResourceWatch` and `resolveSessionConfig` all declare `ahp-root://` as their channel. The four root actions and their origins are [AHP.md](AHP.md#root--4-of-4).

## What a host announces

Every entry of `agents` is one backend, as the protocol's `AgentInfo`:

| Field | What it says |
| --- | --- |
| `provider` | The id a client names in `createSession`, and the scheme its session URIs use |
| `displayName`, `description` | What a person reads instead of the id |
| `models` | What the backend's probe found, each row carrying its own `provider` because the wire type requires one. A backend that has not answered yet announces none, which is the honest form of "nobody has signed in" |
| `protectedResources` | The resources a client may send `authenticate` a token for. Absent when there are none, which means no credential can be handed to this backend at all |
| `customizations` | The skills, subagents and MCP servers a session of this backend starts with, so a client can show what a harness offers before any session exists |
| `capabilities` | `multipleChats`, with `fork` and `sideChat` where the backend can resume at a turn; and `multipleWorkingDirectories`, with `immutablePrimary` and `primaryReplacement` where it takes more than one directory |

`ahpd.grants` is the other half of what a client is told: one entry per subject a grant may name, each with its `title`, a one-line `description`, its `operations` and the two groups those fall into. Ten subjects are the host's own - session, chat, file, automation, terminal, diagnostics, container, config, trust and proxy, plus the people and cost schemes - and every scheme a provider serves is beside them under its own name. A client draws a role editor from this one map, which is why it is advertised with or without a user directory: it says what a role *could* hold, not what anybody holds.

## What a host serves

`file:` is the host's own scheme. Every other scheme in `ahpd.resourceProviders` is a provider's: `user:`, `team:`, `project:` and `role:` when a directory is configured, `policy:` and `usage:` always, and whatever a plugin registered. Each entry carries the provider's own `describe()`, the root URI - `<scheme>://` - and the operations its methods implement, read off the provider rather than off a list somebody maintains.

A scheme is advertised so a client can put its operations in a role and have the gate ask for what it will actually call - decision [A resource scheme is advertised in `_meta`, and a client reads it there](../.project/decisions/a-resource-scheme-is-advertised-in-meta.md). What each scheme is and who may read it is [RESOURCES.md](RESOURCES.md).

## Configuration keys

Every flag can be a key in the configuration file instead, spelled without the dashes. How the files are found, merged and checked is [DAEMON.md](DAEMON.md#configuration); this is what the keys are.

| Key | Values | Default | What changes |
| --- | --- | --- | --- |
| `port` | integer | `9187`; `0` picks a free one | The port the host listens on |
| `host` | address | `127.0.0.1` | The address it binds. `0.0.0.0` accepts from other machines, and then a token is required |
| `paths` | list of directories | the directory the daemon was started in | The directories this host catalogues |
| `worktreesRoot` | directory | `<repo>.worktrees` beside each repository | Where session worktrees are kept |
| `clientToolTimeoutMs` | integer, milliseconds | `600000` (ten minutes) | How long a tool call a client runs may wait for that client. `0` waits for ever |
| `deltaWindowMs` | integer, `0` to `1000` | `75` | How long a turn's streamed text is gathered before it is sent. `0` sends every delta as it arrives |
| `advancedTools` | boolean | `false` | Offer the tools that declare `advancedPermission` to every session's model |
| `updateCheck` | boolean | `true` | Ask npm, in the background, whether a newer version exists |
| `wire` | file path | unset | Append every frame, both directions, to that file as JSON lines |
| `sessions` | `file` or `memory` | `file` | Where what this host keeps about a session is written - [SESSIONS.md](SESSIONS.md) |
| `automations` | `file` or `memory` | `file` | Whether automations survive a restart, and whether their schedules fire - [AUTOMATIONS.md](AUTOMATIONS.md) |
| `unownedAutomations` | `every` or `none` | `every` | What an automation that names no owner wakes on - [AUTOMATIONS.md](AUTOMATIONS.md) |
| `usage` | `{ "per": "turn" \| "report", "timezone": "<zone>" }` | `per: turn`, the system's own zone | How a turn is written down, and where a day and a week are cut - [USAGE.md](USAGE.md) |
| `policies` | `{ "check": true \| false }` | `false` | Whether the rows saying who may use which agent, model and computer are enforced - [POLICY.md](POLICY.md) |
| `http` | `true`, or `{ "port": <n>, "host": "<addr>" }` | off | Serve the commands over HTTP under `/api` |
| `mcpServers` | an object of server entries | none | The MCP servers every session is offered |
| `plugins` | a list of specs | none | The plugins loaded at startup - [PLUGINS.md](PLUGINS.md) |
| `proxy` | see [PROXY.md](PROXY.md) | none | The providers this host's model proxy calls, and the model names that point at them |

Seven keys are about who may connect rather than about how the host behaves - `connectionToken`, `connectionTokenFile`, `withoutConnectionToken`, `users`, `resource`, `issuer` and `trustToken` - and they are [AUTHENTICATION.md](AUTHENTICATION.md#configuration-keys). `stdio`, `configFile`, `noPlugins`, `noCwd` and `pluginOptions` mean something only when typed, so a file that sets one is warned about and ignored.

Each key that needs more than a line:

`paths` is the list of directories this host catalogues, and the **first** is where a session goes when a client names none. A relative one is taken from the directory of the file that set it, not from where the daemon was started. `--no-cwd` serves only what is named and asks about no other folder; it is refused when the list would be empty. `worktreesRoot` keeps every session worktree under `<dir>/<repo>/<name>` instead of the reference host's `<repo>.worktrees` beside each repository, and is made absolute against the working directory because it is a base other paths are joined to - decision [Worktrees can live under one root, as an option beside the reference's default](../.project/decisions/worktrees-can-live-under-one-root.md).

`deltaWindowMs` is how long the host gathers the streamed text of one part before sending it, in milliseconds: within that window a turn's deltas are merged into one action, so a client draws the same text from fewer envelopes. A wrong value is `...: deltaWindowMs must be an integer between 0 and 1000`.

`wire` appends every frame, both directions, to that file as JSON lines, one message per line with an `_ahpLog` beside it - the shape VS Code's agent host writes its traffic log in. A line over 1 MiB is written again with its strings cut and `_ahpLog.truncated` set; a file over 75 MiB rolls to `<file>.1` and five files are kept. The capture holds every token a client sent in `authenticate`, so each of its files is `0600`. `pnpm wire -- <file>` checks one against the schema.

`usage` says how a turn is written down and where the periods are cut. `per` is `turn`, the default, which holds what a turn has used and writes one record when the turn ends, or `report`, which writes one record for every usage report so a turn still running is already billed for what it has spent. Both bill the same work, and a wrong value is `...: usage.per must be one of turn, report`. `timezone` names, as `Intl` names one, the zone a day starts at and a week starts on - a week is Monday 00:00 there, not the system's own - and the system's own zone is used when the key is absent or names a zone this host cannot read, which is said once at start.

The same store is served as the `usage:` scheme, so a client reads it through the resource calls it already has: `usage://` lists the charged pools that reader may read, `usage://<pool>` reads that pool as `{ pool, kind, name, day, week, month }`, `usage://<pool>/range?from=&until=` reads one total between two days, `usage://<pool>/records?from=&until=` lists the records charged to it, newest first, at most 200, and `usage://groups?by=&from=&until=` sums the records by user, team and project ([USAGE.md](USAGE.md#groups)). A pool name holds colons, so it is one encoded path segment - `usage://project%3Abackend%3Asearch` is `project:backend:search`, not an authority. `ahpd usage` with no pool lists what that caller may see, and with one prints that pool's three totals, cut in `usage.timezone`.

`policies.check` says whether the rows saying who may use which agent, model and computer are enforced. Off by default. The rows are kept and the `policy:` scheme is served either way, so a store can be filled in before anything is switched on; a wrong value is `...: policies.check must be true or false`.

`http` serves the same commands the terminal renders, under `/api`. `true` puts it on the host's own listener; an object with a `port` gives it a listener of its own, and its `host` binds that listener - decision [The HTTP API is off by default, and on the daemon's own port under /api unless http.port is set](../.project/decisions/the-http-api-is-on-the-daemon-port-under-api.md), and [http.host binds the API's own listener](../.project/decisions/http-host-binds-the-apis-own-listener.md). A host with neither a connection token nor a user directory refuses to start with it on, because there would be nothing to hold a request against - decision [A daemon with neither a connection token nor a user directory refuses to start with the HTTP API on](../.project/decisions/an-unconfigured-daemon-does-not-serve-the-http-api.md).

`mcpServers` is the host's own MCP servers, by the name a person gave each, and every session is offered them whatever agent it runs. An entry is one of the two shapes VS Code uses: a `stdio` server needs a `command`, and an `http` one a `url`:

```json
"mcpServers": {
  "files": { "type": "stdio", "command": "mcp-server-filesystem", "args": ["/srv"], "cwd": "/srv", "env": { "TOKEN": "..." } },
  "issues": { "type": "http", "url": "http://127.0.0.1:9310/mcp", "headers": { "Authorization": "Bearer ..." } }
}
```

An entry that is neither shape, or that is missing the one its own `type` needs, is one warning in the log and is left out: one server nobody can reach is a gap in one agent's reach, where a wrong `port` is a daemon that would not run at all. A value in `env` or in `headers` is a credential, so each answers `<set>` here and over the API alike - decision [The host's MCP servers are the root config key `mcpServers`, as in VS Code, merged per session with its client plugins' servers](../.project/decisions/the-hosts-mcp-servers-are-root-config-as-in-vscode.md).

`plugins` names what is loaded at startup: a package, a path, or a package installed in the configuration directory. Naming one runs its code in this process with this process's permissions, which is why installing a plugin is the trust decision. A plugin is loaded once and its options make its variants, so an entry may be an object naming one with its `options` and `enabled` - [PLUGINS.md](PLUGINS.md).

## Root config

Root config is not a file. It is the record a client pushes to `ahp-root://` with `root/configChanged`, kept per host, and read back on every root state. Two kinds of key live in it: the host's own, which this host acts on, and the daemon's, which are the keys of `config.json` a client may edit.

The host's own schema is five keys, and it is what a client draws its controls from. A key in the schema is a promise that pushing it changes something.

| Key | Values | Default | What it changes |
| --- | --- | --- | --- |
| `defaultShell` | absolute path | the system shell | The shell a host-managed terminal opens |
| `workspaceTrust` | `{ "enabled": bool, "trustedUris": [uri] }` | none | Which folders the window that pushed it trusts. `readOnly`: the window pushes it, it is not a control |
| `artifactToolsCompactPrompts` | boolean | `false` | Use the short artifact instruction and tool description. It changes the wording only, never whether a tool is offered |
| `deferredTitleGeneration` | boolean | `false` | Give a session a deferred title strategy, under which renaming a chat happens only when the user asks |
| `globalAutoApproveEnabled` | boolean | `false` | Run every tool call without asking, for every session on this host |

`defaultShell` and `workspaceTrust` are **per connection**: they are kept on the connection that pushed them, and a connection reads its own back rather than whatever was pushed last - decision [A host-wide root setting needs config:write, and a person's own needs only a sign-in](../.project/decisions/host-wide-root-settings-need-config-write.md). The rest are one setting for the whole host. The declaration, and the refusal of a key nobody declared, are decision [The root config declares every key VS Code pushes, as the reference declares it, and refuses a key nobody declares](../.project/decisions/root-config-declares-what-vscode-pushes-and-refuses-the-rest.md) and [The root config grows the artifact prompt switch and deferred title generation](../.project/decisions/root-config-grows-two-keys.md).

The daemon's half is added to the same schema, and `config:read` is what a connection needs to be shown it. It is `paths`, `port`, `host`, `http`, `updateCheck`, `advancedTools`, `wire` and `mcpServers`, and each configured plugin is one more key, `plugins.<name>`, whose value is `{ enabled, options }` - so one plugin is one key and its variants are its own options. Nothing else the file holds is there: `stdio`, `configFile`, `noCwd`, `worktreesRoot`, `clientToolTimeoutMs`, the connection token keys, `trustToken`, `issuer`, `resource`, `users`, `automations` and `sessions` are still edited the way they always were. A plugin's configuration travelling in root config rather than in customizations is decision [A plugin's configuration travels in root config, not in customizations](../.project/decisions/plugin-configuration-travels-in-root-config.md).

Pushing a key acts in one of two ways, and the answer says which.

- `advancedTools`, `wire` and `mcpServers` apply to this daemon as written. The tools every running session's model is offered change at once; the wire capture starts, moves or stops; `mcpServers` is read again for the next session opened, while a running session keeps the servers it started with.
- Every other key is written to `config.json` and the answer puts `ahpd.restartNeeded` in the `_meta` of the root state, which every reader of root is shown whether or not it may see the keys the notice is about. `ahpd restart` applies it.

That split, and the reason it is per key rather than all-or-nothing, is decision [A configuration change applies live where the key can, and otherwise on `ahpd restart`](../.project/decisions/a-configuration-change-applies-live-or-on-ahpd-restart.md).

A key shows what the file holds rather than what this run is using, and when a start flag overrode it the key's description says so. A credential is never sent back: every value a plugin's own options schema marks `writeOnly`, however deep in its options the mark sits, is answered as `<set>`, here and over the API alike, and a client that sends that back has said the credential is left as it is - decision [Daemon and plugin keys reach only connections with config:read, and a write-only value never leaves the host](../.project/decisions/root-config-shows-daemon-keys-to-config-read-and-never-a-write-only-value.md).

## Commands

The verbs that read or change this host's own settings, one line each. The rest are [DAEMON.md](DAEMON.md#commands).

| Command | What it does |
| --- | --- |
| `ahpd config` | Print every file it read, then each key and its value, each naming the file that set it |
| `ahpd configure` | Ask at the terminal for each setting a first install needs, and write them |
| `ahpd status` | Say whether a daemon is running, and where |
| `ahpd restart` | Stop it and start it again with the same line, which is what applies a change that is not live |

## Grants

| What | Grant | Where it is asked |
| --- | --- | --- |
| Read the daemon's own settings in root state | `config:read` | `seesConfig`, and the `status` and `plugin list` commands - decision [`status` and `plugin list` need config:read](../.project/decisions/status-and-plugin-list-need-config-read.md) |
| Change a host-wide root config key | `config:change` | `root/configChanged`, and a `replace` - `config:write` covers it |
| Push `workspaceTrust` | `trust:push` | The same action, when every key it carries is a connection's own - `trust:write` covers it |
| Push only `defaultShell` | none, but a sign-in | It changes nothing anybody else reads |
| Stop the daemon | `config:change` | The `shutdown` command - decision [A client's `shutdown` needs `config:change`, and the root connection always may](../.project/decisions/shutdown-needs-config-change.md) |
| Edit the configuration over HTTP | `config:write` | `GET /api/config`, and the `plugin` verbs that write - the deployment token only, for those |

## See also

| | |
| --- | --- |
| [DAEMON.md](DAEMON.md) | The process: its verbs, its flags and how it reads its configuration |
| [AHP.md](AHP.md#root--4-of-4) | The root channel's actions and their origins |
| [AUTHENTICATION.md](AUTHENTICATION.md) | The door, the tokens and the seven keys about who may connect |
| [RESOURCES.md](RESOURCES.md) | The schemes this host serves and who may read them |
| [PLUGINS.md](PLUGINS.md) | What a plugin contributes to a host |
