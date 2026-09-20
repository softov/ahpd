# Running the daemon

`@ahpd/server` is `@ahpd/sdk` with the Claude backend and every port wired in,
plus argv, a configuration file and a pid file. [packages/server/src/main.ts](../packages/server/src/main.ts)
is the whole of it and is short enough to read.

It installs the `ahpd` command:

```bash
npm i -g @ahpd/server
```

From a checkout instead, `ahpd` below means `node packages/server/dist/main.js`
after `pnpm install && pnpm build`.

## Commands

```
ahpd [options]              run it here, in this terminal
ahpd start [options]        run it in the background and let go of it
ahpd stop                   stop the one running in the background
ahpd status                 say whether one is, and where
ahpd config                 say where the configuration is, and what it says
ahpd plugin list            what the configuration names, and what a run would
                            load, without loading any of it
```

`start` re-runs this same program with the rest of the line and detaches, so
the daemon outlives the shell. It records itself in `daemon.json` beside the
configuration and writes what it says to `daemon.log`, because a background
process with no output leaves nothing to read when it misbehaves. Options are
parsed by `start` as well as by the child, so a bad one is refused before
anything has been let go of.

## Options

| flag | |
| --- | --- |
| `--port <n>` | Default `9187`. `0` picks a free one |
| `--host <addr>` | Default `127.0.0.1`. `0.0.0.0` accepts from other machines and needs a token |
| `--path <dir>` | A directory this host catalogues. Repeatable. Default: where the daemon started |
| `--connection-token <secret>` | Require this secret on every connection |
| `--connection-token-file <p>` | Require the secret in this file, writing a fresh one if it is not there |
| `--without-connection-token` | Accept any connection |
| `--config-file <p>` | Read this instead of the file below |
| `--automations <where>` | `file`, the default, or `memory`. See below |
| `--sessions <where>` | `file`, the default, or `memory`: where the read and archived bits and a session's settings go |
| `--wire <file>` | Append every frame, both directions, to this file as JSON lines. `pnpm wire -- <file>` checks it against the schema |
| `--plugin <spec>` | A plugin to load: a package, a path, or an object. Repeatable, applied in order. See below |
| `--no-plugins` | Load none, whatever the configuration file says |
| `--no-update-check` | Never ask npm whether a newer version exists. See below |
| `--version`, `-v` | What version this is |
| `--help`, `-h` | |

### `--automations`, and what memory costs

`file` is the default: definitions are written to `automations.json` beside the
configuration, come back on a restart, and a clock fires the ones with a
schedule. It is the mode a daemon wants, because being running at nine in the
morning is the only way a schedule fires with nobody connected.

`memory` holds definitions for as long as the process does and fires nothing.
A client may still write, patch, list and run one by hand; what it will not get
is a `nextRunAt`, which is the honest form of "this host will not fire that".

Both are the same `AutomationStore`, so the host is not told which it was
given. Runs are in memory either way: a run names the sessions it started, and
those went when the process did.

### `--path`, and what it is not

A path is a directory on the machine **the daemon runs on**. The first is where
a session goes when the client names none, and is what the host advertises as
its default; the catalogue is the union of all of them, so past sessions in any
of them are listed and nothing goes missing by adding one.

```bash
ahpd --path /work/api --path /work/web
```

It is not a fence. A client may name any directory on the machine for a
session, a terminal or a `resource*` request, the way the reference host lets
it: the window's folder dialog lists `..` from wherever it is and picks what is
typed, and a host that refused everything outside `--path` was one where no
folder outside it could be picked at all. Who may ask is decided once, by the
connection token - which is why a host on `0.0.0.0` will not start without one.

### `--no-update-check`, and knowing when it is old

The daemon asks npm, six hours apart, whether a newer `@ahpd/server` exists,
and writes the answer to `update.json` beside the configuration. Its startup
line, `ahpd start` and `ahpd status` read that file and say so when there is
one:

```
update: @ahpd/server 0.6.0 is on npm, this is 0.5.0
```

Nothing waits on the network: the line is what the file said last time, the
request is made in the background after the daemon is up, and a fresh install
says nothing on its first start because there is no file yet. The request is
`GET <registry>/-/package/@ahpd/server/dist-tags`, eighteen bytes, against
`npm_config_registry` when that is set and `registry.npmjs.org` otherwise, so
a mirror is not reached past. Every failure is silence - offline, a proxy
that answers nothing, a registry that is down - because none of them is
something to act on from here.

Off with `--no-update-check`, with `NO_UPDATE_NOTIFIER` or `CI` set to
anything in the environment, or with `"updateCheck": false` in the file. The
daemon has no terminal, so the file is the one that matters.

### `--plugin`, and what naming one runs

A plugin is an installed package that contributes to the host the daemon
builds: a backend, one of its ports, a server tool or a configuration default.
It is named on the command line or in the configuration file.

```bash
ahpd --plugin @ahpd/agent-facio --plugin ./my-plugin
```

`--plugin` is repeatable and the plugins apply in the order they are named.
`--no-plugins` loads none, whatever the file says, and passing it beside a
`--plugin` is refused as contradictory. A command line `--plugin` **replaces**
the file's `plugins` list rather than adding to it, the way `--path` replaces
`paths`.

A spec is a package name, a path to a directory or a file, or an object naming
one with the options `apply` receives and whether it is on:

```json
{
  "plugins": [
    "@ahpd/agent-facio",
    { "name": "./my-plugin", "options": { "token": "…" }, "enabled": false }
  ]
}
```

A bare name is resolved from the configuration directory's own `node_modules`,
so `npm i` there is the install. A relative path is tried against the working
directory and then the configuration directory, and the absolute path that ran
is on the log.

Naming a plugin **runs its code in this process with this process's
permissions**, so the configuration file is the trust boundary here the way the
token is the port's. A plugin that does not resolve, whose manifest is wrong,
or that throws is reported on stdout and skipped; the one failure that refuses
the start is two plugins claiming the same agent `provider`, because a host
built over that answers a turn with the wrong backend.

`ahpd plugin list` prints one line per spec - its state, where it resolves, and
the name and title its manifest declares - without importing any of it. The
states are `ready`, `incompatible`, `unconfigured`, `disabled`, `missing` and
`error`, and a plugin that would throw on load still lists as `ready`, which is
the reason the `ahpd` key lives in `package.json` at all.

## Configuration

XDG: `$XDG_CONFIG_HOME/ahpd/config.json`, or `~/.config/ahpd/config.json`.
Every flag can be a key instead, spelled without the dashes:

```json
{
  "port": 9187,
  "host": "127.0.0.1",
  "paths": ["/work/api", "/work/web"],
  "connectionTokenFile": "/home/you/.ahpd/token"
}
```

A flag beats the file, because a flag is this run and a file is every run until
somebody edits it. `paths` and `plugins` are the two exceptions worth knowing: a
`--path` or a `--plugin` on the command line **replaces** its list rather than
adding to it, so a file naming two and a flag naming a third loads one, not
three. `updateCheck` is the one key with no value to give: `false` is
`--no-update-check`, and anything else is the default. `--no-plugins` is the one
flag with no key: leaving `plugins` out is already the off.

`ahpd config` prints the path it read and what was in it.

## Who may connect

Loopback with no token needs no secret: anything reaching `127.0.0.1` is already
on this machine. Binding anything else without one of the three token flags
refuses to start, rather than putting a host on the network that anybody can
drive.

```bash
ahpd --host 0.0.0.0 --connection-token-file ~/.ahpd/token   # written if absent, owner-readable
ahpd --host 0.0.0.0 --connection-token "$SECRET"
ahpd --host 0.0.0.0 --without-connection-token              # deliberately open
```

Clients present it as `?tkn=<secret>` on the WebSocket URL or as an
`Authorization: Bearer <secret>` header. The query string is the one that always
works, because a browser cannot set headers on a WebSocket handshake. A wrong
token is refused with **401 at the handshake**, so it never reaches the host.

```bash
ahpc --host ws://192.168.1.10:9187 --token "$SECRET"
```

Only stdout says where the token came from, never what it is.

This is the *connection* token, which is about who may reach the host at all.
The token a client pushes with `authenticate` is a different thing and is
covered in [AHP.md](AHP.md#authentication).

## Clients

```bash
ahpc --host ws://127.0.0.1:9187
```

VS Code, in `settings.json`:

```json
"chat.remoteAgentHostsEnabled": true,
"chat.remoteAgentHosts": [
  { "name": "ahpd", "address": "ws://127.0.0.1:9187", "connectionToken": "…" }
]
```

`address` may be bare (`127.0.0.1:9187`) or a full `ws://` / `wss://` URL; the
client puts the token on the URL as `?tkn=`, which is one of the two forms this
host accepts. `connectionToken` may be left out for a loopback host started
without one.

## Runtimes

```bash
node packages/server/dist/main.js --port 9187 --path /work/project   # Node
bun  packages/server/dist/main.js --port 9187 --path /work/project   # Bun
deno run -A packages/server/dist/main.js --port 9187 --path /work    # Deno
```

The runtime is detected at startup and named in the first line of output. Node
needs the optional `ws` dependency, having no WebSocket server of its own; Bun
and Deno use their built-in servers and need nothing.
[packages/sdk/src/listen.ts](../packages/sdk/src/listen.ts) is the only file that knows which one it is on.

All three are run. Deno was proved on **2.9.6** against the built output,
driving a whole session - handshake, catalogue, changeset, operations, the
write half and a resource watch. Run `dist/` rather than `src/` there, or pass
`--sloppy-imports`: the sources import `./x.js` the way the emitted output
does, and Deno reads that literally.

## While you are changing it

```bash
pnpm dev          # node
pnpm dev:bun      # bun
pnpm echo         # the same pair, for examples/echo
pnpm echo:bun
pnpm notes        # and for examples/notes
pnpm notes:bun
```

All six run the TypeScript source, restart on save, compile nothing and install
nothing. Each names the runtime it is on in its first line of output, so there
is never a question which one answered. The `:bun` half exists because
`listen.ts` is one file and three code paths, and a change to it wants running
under more than one before it is believed.

The difference between them is in what each needs to find a file. This source
spells its own imports `./host.js`, because that is what will be there after a
build. Bun rewrites those to the `.ts` on disk by itself; Node resolves them
literally and looks for a `host.js` that does not exist yet, so the Node scripts
register [scripts/dev-hooks.mjs](../scripts/dev-hooks.mjs) to do the same
rewrite - about twenty lines, no dependency.

Node also strips types rather than transforming them, so it cannot run the
TypeScript that *emits* code: enums, namespaces, and constructor parameter
properties. There are none here, and `test/strippable.test.ts` is what keeps it
that way.
