# @ahpd/server

[`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) is a ready-to-run [Agent Host Protocol](https://microsoft.github.io/agent-host-protocol/) server. It installs the `ahpd` command.

It runs agent sessions and serves them over a WebSocket, so several clients can watch and drive the same session at once.

It is built on [@ahpd/sdk](https://www.npmjs.com/package/@ahpd/sdk) and currently ships with a Claude agent backend, which is the only one so far.

- [`@ahpd/agent-claude`](https://www.npmjs.com/package/@ahpd/agent-claude) is the Claude backend.

Backends are registered at startup, so adding another does not change the server.

To serve a different agent, you can write your own server with [@ahpd/sdk](https://www.npmjs.com/package/@ahpd/sdk). Create an implementation of the `Agent` interface and pass it to `createHost`.

## Install

```bash
npm i -g @ahpd/server
ahpd --path /work/project
```

Or run it without installing:

```bash
npx @ahpd/server --path /work/project
```

It listens on `ws://127.0.0.1:9187`. Run it with no arguments to serve the directory you are in.

Needs Node 22 or later. Also runs on Bun and Deno.

## Commands

```
ahpd [options]              run it in this terminal
ahpd start [options]        run it in the background
ahpd stop                   stop the background one
ahpd status                 say whether one is running, and where
ahpd config                 print the config file path and its contents
```

`start` re-runs the same program detached. It writes its output to `daemon.log` and records the pid and URL in `daemon.json`, both next to the config, which is where `status` reads from and how you find out what happened after the fact.

## Options

| flag | |
| --- | --- |
| `--port <n>` | Default `9187`. Use `0` for a free port |
| `--host <addr>` | Default `127.0.0.1`. Use `0.0.0.0` to accept remote connections, which requires a token |
| `--path <dir>` | A directory to serve. Repeatable. Defaults to the working directory |
| `--connection-token <secret>` | Require this secret on every connection |
| `--connection-token-file <p>` | Require the secret in this file. Writes a new one if the file is missing |
| `--without-connection-token` | Accept any connection |
| `--config-file <p>` | Use this config file instead of the default |
| `--automations <where>` | `file`, the default, keeps them beside the config and fires their schedules. `memory` keeps them until the process ends and fires nothing |
| `--version`, `-v` | What version this is |
| `--help`, `-h` | |

`--version` and `--help` are the two that are not configuration; every other flag also has a key in `config.json` under `$XDG_CONFIG_HOME/ahpd`, spelled the same way without the dashes. A flag beats the file. Run `ahpd config` to see the path and the current values.

## Directories

`--path` is repeatable:

```bash
ahpd --path ~/src/project-a --path ~/src/project-b
```

The first is the default, and it is what a client gets when it names no directory. A directory that was not named is refused rather than served, so one daemon serves exactly the paths you gave it.

## Remote connections

It binds to loopback and needs no token there. Binding anywhere else does:

```bash
ahpd --host 0.0.0.0 --connection-token <secret>
```

Or keep the secret in a file, which is written with a fresh one if it is not there yet:

```bash
ahpd --host 0.0.0.0 --connection-token-file ~/.config/ahpd/token
```

Clients present it as `?tkn=<secret>` on the URL or as an `Authorization: Bearer <secret>` header.

`--without-connection-token` binds without one. Only do that when something else is already keeping the port to yourself.

## What it serves

Sessions, chats and turns with streaming responses, tool calls and approvals, questions from the agent, file reads and writes, a shell as a terminal channel, git branches and changesets, sessions in their own worktree, scheduled automations, and OTLP telemetry.

The Claude backend adds what Claude has: models and effort, permission modes, skills and slash commands, MCP servers, and OAuth sign-in.

With the Claude backend, past sessions are read from Claude's transcript files. Opening one does not start anything. The agent process starts when you send a turn.

## Connecting

Any AHP client works. [`ahpc`](https://github.com/softov/ahpc) is one:

```bash
ahpc --host ws://127.0.0.1:9187
```

## Packages

`@ahpd/server` is a thin wrapper over two libraries:

- [`@ahpd/sdk`](https://www.npmjs.com/package/@ahpd/sdk) is the protocol and the ports. It has no backend in it.
- [`@ahpd/agent-claude`](https://www.npmjs.com/package/@ahpd/agent-claude) is the Claude backend.

The daemon is those two and a socket:

```ts
import { createHost, listen } from '@ahpd/sdk';
import { claude } from '@ahpd/agent-claude';

const host = createHost({ path, agents: [claude({ paths: [path] })] });
await listen({ port: 9187 }, (peer) => host.accept(peer));
```

If you want a host of a different shape, build it from `@ahpd/sdk` and skip this package. To serve a different agent, write an `Agent` and add it to `agents`. See [docs/AGENT.md](https://github.com/softov/ahpd/blob/main/docs/AGENT.md).

## Documentation

| | |
| --- | --- |
| [DAEMON.md](https://github.com/softov/ahpd/blob/main/docs/DAEMON.md) | The CLI, config file, connection tokens, and Node/Bun/Deno |
| [LIBRARY.md](https://github.com/softov/ahpd/blob/main/docs/LIBRARY.md) | Building a host with `@ahpd/sdk` |
| [AGENT.md](https://github.com/softov/ahpd/blob/main/docs/AGENT.md) | Writing another agent backend |
| [AHP.md](https://github.com/softov/ahpd/blob/main/docs/AHP.md) | Protocol coverage, and every action it emits |
| [agent-host-protocol](https://github.com/microsoft/agent-host-protocol) | The protocol itself, and its [documentation](https://microsoft.github.io/agent-host-protocol/) |

## License

MIT © Softov

