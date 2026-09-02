# Running the daemon

`ahpd` the daemon is `ahpd` the library with the Claude backend and every port
wired in, plus argv, a configuration file and a pid file. [src/main.ts](../src/main.ts)
is the whole of it and is short enough to read.

Not published to npm yet, so `ahpd` below means `node dist/src/main.js` after
`npm install && npm run build`.

## Commands

```
ahpd [options]              run it here, in this terminal
ahpd start [options]        run it in the background and let go of it
ahpd stop                   stop the one running in the background
ahpd status                 say whether one is, and where
ahpd config                 say where the configuration is, and what it says
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
| `--path <dir>` | A directory this host serves. Repeatable. Default: where the daemon started |
| `--connection-token <secret>` | Require this secret on every connection |
| `--connection-token-file <p>` | Require the secret in this file, writing a fresh one if it is not there |
| `--without-connection-token` | Accept any connection |
| `--config-file <p>` | Read this instead of the file below |
| `--help`, `-h` | |

### `--path`, and why a client cannot name its own

A path is a directory on the machine **the daemon runs on**. The first is where
a session goes when the client names none, and is what the host advertises as
its default; the catalogue is the union of all of them, so nothing goes missing
by adding one.

```bash
ahpd --path /work/api --path /work/web
```

A directory the host was not told to serve is refused, with the list of what it
does serve, rather than quietly replaced. A host that ran the agent wherever it
was told is one that anybody who can reach the port can point at any directory
on the machine; a directory accepted and then ignored is a session running
somewhere nobody asked for, with nothing on screen saying which.

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
somebody edits it. `paths` is the one exception worth knowing: a `--path` on the
command line **replaces** the list rather than adding to it, so a file naming
two and a flag naming a third serves one, not three.

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
node dist/src/main.js --port 9187 --path /work/project   # Node
bun  dist/src/main.js --port 9187 --path /work/project   # Bun
deno run -A dist/src/main.js --port 9187 --path /work    # Deno
```

The runtime is detected at startup and named in the first line of output. Node
needs the optional `ws` dependency, having no WebSocket server of its own; Bun
and Deno use their built-in servers and need nothing.
[src/listen.ts](../src/listen.ts) is the only file that knows which one it is on.

All three are run. Deno was proved on **2.9.6** against the built output,
driving a whole session - handshake, catalogue, changeset, operations, the
write half and a resource watch. Run `dist/` rather than `src/` there, or pass
`--sloppy-imports`: the sources import `./x.js` the way the emitted output
does, and Deno reads that literally.

## While you are changing it

```bash
npm run dev          # node
npm run dev:bun      # bun
npm run echo         # the same pair, for examples/echo
npm run echo:bun
npm run notes        # and for examples/notes
npm run notes:bun
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
