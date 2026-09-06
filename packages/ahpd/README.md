# ahpd

An [Agent Host Protocol](https://github.com/microsoft/agent-host-protocol) daemon
that runs Claude Code sessions. One host, one set of directories, one port —
speaking AHP over a WebSocket, so an editor, a terminal client and a script can
all be in the same conversation at once.

```bash
npm i -g ahpd
ahpd --path /work/project
```

Runs on Node, Bun or Deno.

## Commands

```
ahpd [options]              run it here, in this terminal
ahpd start [options]        run it in the background and let go of it
ahpd stop                   stop the one running in the background
ahpd status                 say whether one is, and where
ahpd config                 say where the configuration is, and what it says
```

`start` re-runs this same program detached, records itself beside the
configuration, and writes what it says to a log — a background process with no
output leaves nothing to read when it misbehaves.

## Options

| flag | |
| --- | --- |
| `--port <n>` | Default `9187`. `0` picks a free one |
| `--host <addr>` | Default `127.0.0.1`. `0.0.0.0` accepts from other machines and needs a token |
| `--path <dir>` | A directory this host serves. Repeatable. Default: where it started |
| `--connection-token <secret>` | Require this secret on every connection |
| `--connection-token-file <p>` | Require the secret in this file, writing a fresh one if it is not there |
| `--without-connection-token` | Accept any connection |
| `--config-file <p>` | Read this instead of the default |
| `--help`, `-h` | |

Every flag has a key in `config.json` under `$XDG_CONFIG_HOME/ahpd`, and
`ahpd config` says where that is and what it currently says.

## What it serves

Sessions and the turns in them, tool calls and their confirmation, the agent's
own questions, files a client may read and write, a shell as a terminal channel,
what the working tree has that HEAD does not, agents on a cron with nobody
connected, and telemetry as OTLP.

Past sessions are reconstructed from Claude's transcripts, so a client can browse
and read a conversation without starting anything; the agent process begins when
somebody sends a turn.

## Connecting

Any AHP client. [`ahpc`](https://github.com/softov/ahpc) is a chat and CLI client
for it:

```bash
ahpc --host ws://127.0.0.1:9187
```

## Built out of

| | |
| --- | --- |
| [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) | the protocol and the ports, with no backend inside |
| [`@ahpd/agent-claude`](https://www.npmjs.com/package/@ahpd/agent-claude) | the Claude backend, as one `Agent` |

This package is those two, argv, and a socket. If you want a host of your own
shape, take `@ahpd/server` and skip this.

## Documentation

| | |
| --- | --- |
| [DAEMON.md](https://github.com/softov/ahpd/blob/main/docs/DAEMON.md) | The CLI, the configuration file, connection tokens, Node/Bun/Deno |
| [AHP.md](https://github.com/softov/ahpd/blob/main/docs/AHP.md) | Compatibility area by area, and every action it emits |

MIT © Luiz Fernando Softov
