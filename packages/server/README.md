# @ahpd/server

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fserver)](https://www.npmjs.com/package/@ahpd/server)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

A ready-to-run [Agent Host Protocol](https://microsoft.github.io/agent-host-protocol/) server. It installs the `ahpd` command, runs agent sessions, and serves them over a WebSocket, so several clients can watch and drive the same session at once.

Part of [ahpd](https://github.com/softov/ahpd). The source is in [`packages/server`](https://github.com/softov/ahpd/tree/main/packages/server), and it is built on [`@ahpd/sdk`](https://www.npmjs.com/package/@ahpd/sdk).

It bundles no agent. Every backend is a plugin you install beside it:

- [`@ahpd/agent-claude`](https://www.npmjs.com/package/@ahpd/agent-claude): Claude Code, through the Claude Agent SDK.
- [`@ahpd/agent-acp`](https://www.npmjs.com/package/@ahpd/agent-acp): any [Agent Client Protocol](https://agentclientprotocol.com/) server, one provider per configured command.
- [`@ahpd/agent-cofold`](https://www.npmjs.com/package/@ahpd/agent-cofold): any OpenAI-compatible endpoint, through the cofold runtime.
- [`@ahpd/agent-pi`](https://www.npmjs.com/package/@ahpd/agent-pi): the pi coding agent, embedded in the daemon.

A daemon with no backend refuses to start and says how to install one. To serve another agent, write an `Agent` and load it the same way: see [docs/AGENT.md](https://github.com/softov/ahpd/blob/main/docs/AGENT.md) and [docs/PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/PLUGINS.md).

## Install

The daemon, and a backend for it to serve:

```bash
npm i -g @ahpd/server
ahpd plugin install @ahpd/agent-claude
ahpd --plugin @ahpd/agent-claude --path /work/project
```

`ahpd plugin install` runs `npm install` in the configuration directory, where a bare plugin name is resolved from, and adds the name to `plugins` in `config.json` so the next run loads it. A plugin installed with `npm i -g` is not seen.

To upgrade, run `npm i -g @ahpd/server`, then `ahpd plugin update all` to move every installed plugin to the daemon's version (or `ahpd plugin update <name>...` for only some), then restart the daemon. ahpd installs the daemon's own `@ahpd/sdk` beside the plugins, so one plugin never blocks another, and a plugin whose `@ahpd/sdk` range leaves out the daemon's is refused when the daemon loads it.

npm 12 blocks install scripts unless told otherwise, and `node-pty` needs its script on Linux to build the terminal binding. Without it the daemon still runs, but terminals fall back to pipes (`isPty: false`). Add `--allow-scripts=node-pty` to the daemon's global install, or run `npm config set allow-scripts=node-pty --location=user` once.

It listens on `ws://127.0.0.1:9187`. Run it with no arguments to serve the directory you are in.

Needs Node 22 or later. Also runs on Bun and Deno.

## Commands

```
ahpd [options]              run it here, in this terminal
ahpd start [options]        run it in the background
ahpd stop                   stop the background one
ahpd restart                stop it and start it again with the same line; --force restarts while a turn runs
ahpd status                 say whether one is running, and where
ahpd config                 say where the configuration is, and what it says
ahpd configure              ask at the terminal for each setting a first install needs
ahpd user list              who is in the user file
ahpd user add <id>          add a person, with --role, --membership, --primary and --issuer
ahpd user rm <id>           take a person out
ahpd user token <id>        mint their credential, shown once; --url prints the whole ws:// URL
ahpd user member <id> <t>   replace their memberships; --unset takes the whole list away
ahpd user primary <id> <t>  set their primary membership, or --unset to take it away
ahpd team list              what this install names as a team
ahpd team add <id>          name a team, with --title
ahpd team rm <id>           take a team out; refused while a membership names it
ahpd project list           what this install names as a project
ahpd project add <id>       name a project, with --title
ahpd project rm <id>        take a project out; refused while a membership names it
ahpd plugin list            what the configuration names, and what a run would load
ahpd plugin install <name>  install a plugin and name it in the configuration, unless --no-enable
ahpd plugin remove <name>   drop it from the configuration and uninstall it, unless --keep
ahpd plugin update all      move every installed plugin to the daemon's version
ahpd plugin update <name>   move only the plugins named
ahpd plugin config <name>   show a plugin's options
ahpd plugin config <name> <key> <value>   set one of them
ahpd plugin config unset <name> <key>     take one of them away
ahpd plugin enable <name>   turn a configured plugin on
ahpd plugin disable <name>  turn it off, keeping its entry and its options
ahpd proxy list             the built-in providers, and every model they serve
ahpd usage                  every pool a record was charged to
ahpd usage <pool>           what one pool spent, over three periods
ahpd vault set <name>       keep a value under a name, read from standard input
ahpd vault delete <name>    take a name out of the vault
ahpd vault list             every name this host keeps a secret under, and whether it is set
ahpd completion <shell>     print the completion script: bash, zsh or fish
```

`start` runs the same program detached. It writes its output to `daemon.log` and its pid and URL to `daemon.json`, both next to the config, which is where `status` reads from. `restart` is refused while a turn is running unless the line carries `--force`: see [`ahpd restart`](https://github.com/softov/ahpd/blob/main/docs/DAEMON.md#ahpd-restart).

Every command has `--json`, which prints the same value the prose is rendered from, on stdout alone. `--quiet` prints only the identifier an answer names, `--verbose` adds diagnostics on stderr, `--no-color` turns colour off, and `--yes` runs a command that removes something without asking. A command line with no verb runs the daemon, and `ahpd --help` renders every command and the foreground run's flags: see [`--json`, for the things a script reads](https://github.com/softov/ahpd/blob/main/docs/DAEMON.md#--json-for-the-things-a-script-reads).

[DAEMON.md](https://github.com/softov/ahpd/blob/main/docs/DAEMON.md#commands) has the detail of each command: [`configure`](https://github.com/softov/ahpd/blob/main/docs/DAEMON.md#ahpd-configure), [`vault`](https://github.com/softov/ahpd/blob/main/docs/DAEMON.md#the-vault), [`completion`](https://github.com/softov/ahpd/blob/main/docs/DAEMON.md#completion) and [`--remote`](https://github.com/softov/ahpd/blob/main/docs/DAEMON.md#--remote-the-same-cli-against-a-daemon) among them.

Every verb and every flag is one declaration under [`src/commands`](https://github.com/softov/ahpd/tree/main/packages/server/src/commands), and the table below says which file declares what.

| File | What it declares |
| --- | --- |
| [run.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/commands/run.ts) | `ahpd [options]`, the foreground daemon, and every flag a run takes |
| [start.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/commands/start.ts) | `ahpd start` |
| [stop.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/commands/stop.ts) | `ahpd stop` |
| [restart.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/commands/restart.ts) | `ahpd restart` |
| [status.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/commands/status.ts) | `ahpd status` |
| [config.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/commands/config.ts) | `ahpd config` |
| [configure.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/commands/configure.ts) | `ahpd configure` |
| [user.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/commands/user.ts) | `ahpd user list`, `add`, `rm`, `token`, `member`, `primary` |
| [teams.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/commands/teams.ts) | `ahpd team list`, `add`, `rm` and the same three for `project` |
| [plugin.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/commands/plugin.ts) | `ahpd plugin list`, `install`, `remove`, `update`, `config`, `config set`, `config unset`, `enable`, `disable` |
| [proxy.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/commands/proxy.ts) | `ahpd proxy list` |
| [usage.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/commands/usage.ts) | `ahpd usage` and `ahpd usage <pool>` |
| [vault.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/commands/vault.ts) | `ahpd vault set`, `delete`, `list` |
| [options.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/commands/options.ts) | Every flag and every configuration key, as one declaration |
| [registry.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/commands/registry.ts) | The registry each surface renders, and the commands `--remote` fetches |
| [served.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/commands/served.ts) | The registry a daemon serves over HTTP |
| [authorize.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/commands/authorize.ts) | Who a request is, read from its `Authorization` header |
| [scopes.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/commands/scopes.ts) | The grant check every registry runs before a command body |

## Options

| flag | |
| --- | --- |
| `--port <n>` | Default `9187`. `0` picks a free one |
| `--host <addr>` | Default `127.0.0.1`. `0.0.0.0` accepts remote connections and needs a token |
| `--path <dir>` | A directory this host serves. Repeatable; the first is the default a client gets when it names none |
| `--no-cwd` | Serve only the directories named above, and never ask about the working directory. Refused when none is named |
| `--worktrees-root <dir>` | Keep every session worktree under this folder, as `<dir>/<repo>/<name>`. Default: `<repo>.worktrees` beside each repository |
| `--connection-token <secret>` | Require this secret on every connection |
| `--connection-token-file <p>` | Require the secret in this file, writing a fresh one if it is not there |
| `--without-connection-token` | Accept any connection |
| `--config-file <p>` | Read this file instead of the one under the configuration directory |
| `--stdio` | Serve one connection over stdin and stdout instead of binding a port. One line of JSON per frame, no token |
| `--users <file>` | The people who may use this host |
| `--resource <url>` | The https identifier this host advertises for its own sign-in. Default: derived from `--host` and `--port` |
| `--issuer <github\|url>` | An authorization server whose tokens are also accepted: `github`, or an OpenID Connect issuer |
| `--trust-token` | A person's connection token authorizes them as well as admits them |
| `--advanced-tools` | Offer the tools that declare they need advanced permission, such as the computer's three |
| `--client-tool-timeout-ms <ms>` | How long a call a client runs may wait. Default ten minutes; `0` waits for ever |
| `--delta-window-ms <ms>` | How long a streamed delta waits for the next one before it is sent. Default `75`; `0` sends every delta as it arrives |
| `--automations <where>` | `file`, the default, keeps them beside the config and fires their schedules. `memory` keeps them until the process ends and fires nothing |
| `--unowned-automations <scope>` | `every`, the default, or `none`: what an automation that names no owner wakes on |
| `--sessions <where>` | Where the read and archived bits, a session's settings, whose each session is and who sent each of its turns go. `file`, the default, keeps them beside the config. `memory` forgets them when the process ends |
| `--wire <file>` | Append every frame, both directions, to this file as JSON lines |
| `--plugin <spec>` | A plugin to load: a package, a path, or an object. Repeatable, and replaces the config file's list |
| `--no-plugins` | Load none, whatever the configuration file says |
| `--plugin-option <plugin>.<key>[.<key>...]=<value>` | Set one option of a loaded plugin for this run, as deep in its options as the key path goes. Repeatable |
| `--update-check`, `--no-update-check` | Ask npm, in the background, whether a newer version exists. On by default |
| `--json` | Print the value the prose is rendered from, as JSON on stdout. Every command takes it |
| `--quiet`, `-q` | Print only the identifiers or values an answer names |
| `--verbose` | Add diagnostics on stderr |
| `--no-color` | Turn colour off. A non-terminal or `NO_COLOR` does the same |
| `--yes` | Run a command that removes something without asking |
| `--remote <url>` | Run the administration commands against a daemon over its HTTP API, rather than here |
| `--token <secret>` | The credential `--remote` presents. Defaults to `AHPD_TOKEN` |
| `--token-file <p>` | Read the credential `--remote` presents from this file |
| `--refresh` | Fetch the command surface `--remote` cached again |
| `--version`, `-v` | What version this is |
| `--help`, `-h` | Every command, then the foreground run's flags |

Every flag is also a key in `config.json` under `$XDG_CONFIG_HOME/ahpd`, spelled the same way without the dashes, except `--stdio`, `--config-file`, `--no-plugins`, `--no-cwd` and `--plugin-option`, which mean something only when typed. A flag beats the file. Five keys are set in the file alone and have no flag: `http`, `usage`, `proxy`, `policies` and `mcpServers`. Run `ahpd config` to see the path and the current values.

## Directories

`--path` is repeatable:

```bash
ahpd --path ~/src/project-a --path ~/src/project-b
```

The first is the default, and it is what a client gets when it names no directory. A directory that was not named is refused.

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

`--without-connection-token` binds without one. Only use it when something else already keeps the port private.

## What it serves

Sessions, chats and turns with streaming responses, tool calls and approvals, questions from the agent, file reads and writes, a shell as a terminal channel, git branches and changesets, sessions in their own worktree, scheduled automations, and OTLP telemetry. Each backend adds its own: models, permission modes, commands, and past sessions read from its own files.

## Connecting

Any AHP client works. [`ahpc`](https://github.com/softov/ahpc) is one:

```bash
ahpc --host ws://127.0.0.1:9187
```

## Embedding

The daemon is `@ahpd/sdk`, the plugins its config names, and a socket. The same host in your own program:

```ts
import { createHost, listen } from '@ahpd/sdk';
import { claude } from '@ahpd/agent-claude';

const host = createHost({ path, agents: [claude({ paths: [path] })] });
await listen({ port: 9187 }, (peer) => host.accept(peer));
```

For a host of a different shape, build it from `@ahpd/sdk` and skip this package.

## Layout

| | |
| --- | --- |
| [src/main.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/main.ts) | argv, the filesystem and stdout; the only file that reads any of the three |
| [src/daemon.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/daemon.ts) | Running detached, and finding the one that is |
| [src/config.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/config.ts) | The config file, and where this tool keeps its files |
| [src/plugins.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/plugins.ts) | Resolving, loading and applying plugins |
| [src/update.ts](https://github.com/softov/ahpd/blob/main/packages/server/src/update.ts) | Asking npm whether a newer version exists, in the background |

## Documentation

| | |
| --- | --- |
| [DAEMON.md](https://github.com/softov/ahpd/blob/main/docs/DAEMON.md) | The CLI, config file, connection tokens, and Node/Bun/Deno |
| [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/PLUGINS.md) | Loading and writing plugins |
| [LIBRARY.md](https://github.com/softov/ahpd/blob/main/docs/LIBRARY.md) | Building a host with `@ahpd/sdk` |
| [AGENT.md](https://github.com/softov/ahpd/blob/main/docs/AGENT.md) | Writing another agent backend |
| [AHP.md](https://github.com/softov/ahpd/blob/main/docs/AHP.md) | Protocol coverage, and every action it emits |
| [agent-host-protocol](https://github.com/microsoft/agent-host-protocol) | The protocol itself, and its [documentation](https://microsoft.github.io/agent-host-protocol/) |

## License

MIT © Softov
