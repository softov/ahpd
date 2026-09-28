# @ahpd/tunnel-devtunnel

[![npm](https://img.shields.io/npm/v/%40ahpd%2Ftunnel-devtunnel)](https://www.npmjs.com/package/@ahpd/tunnel-devtunnel)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

A [Dev Tunnel](https://aka.ms/devtunnels) plugin for the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon. It forwards the daemon's port through a Microsoft Dev Tunnel, labelled the way VS Code expects, so VS Code can find and reach the daemon from a machine on another network.

Part of [ahpd](https://github.com/softov/ahpd). The source is in [`packages/tunnel-devtunnel`](https://github.com/softov/ahpd/tree/main/packages/tunnel-devtunnel).

## What it needs

The [`devtunnel` CLI](https://aka.ms/devtunnels/download), installed and logged in:

```bash
devtunnel user login       # a Microsoft account
devtunnel user login -g    # or a GitHub one
```

## Install

```bash
ahpd plugin install @ahpd/tunnel-devtunnel
```

That installs it where the daemon looks for plugins and adds it to `plugins` in the configuration file. A plugin installed with `npm i -g` is not seen.

The daemon prints the tunnel beside its own address, and `ahpd status` shows it:

```
ahpd on ws://127.0.0.1:9187 (node), sessions in /work
tunnel sunny-otter-9k3 (dev82), port 31546
```

In VS Code, sign in to the same Dev Tunnels account and run **Agents: Connect to Remote Agent Host via Dev Tunnel**. Finding a tunnel needs that sign-in. A direct WebSocket address does not, and is what **Agents: Add Remote Agent Host...** takes.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `name` | this machine's hostname | What the tunnel is called in a client's list |
| `keep` | `true` | Whether the tunnel outlives the daemon |
| `anonymous` | `false` | Whether somebody not signed in to this account may reach it |

```json
{ "plugins": [{ "name": "@ahpd/tunnel-devtunnel", "options": { "name": "dev82", "anonymous": true } }] }
```

Keep `keep` on: a client derives its connection token from the tunnel's id, so a new tunnel on every start is a new token on every start.

## The connection token

A client connecting over a tunnel computes its token from the tunnel's id, as the unpadded base64url of its SHA-256, and presents it as `?tkn=`. Only people who pass the Dev Tunnels access check can reach the tunnel, so the token does not need to be secret.

A daemon on loopback with no connection token of its own accepts it, and that needs no configuration. A daemon started with `--connection-token` refuses it, because the client presents the derived token and not the daemon's. The plugin prints the derived token on its own line so you can make the two agree:

```
tunnel token 4d8f...  - what a client presents over the tunnel; this daemon requires its own
```

## What it does at startup

1. Finds the tunnel it made before, by its own label, or makes one.
2. Labels it `vscode-server-launcher` and `protocolv5`, which is what makes a client list it.
3. Puts port 31546 on it, the fixed port VS Code looks for.
4. Forwards 31546 on loopback to the port the daemon bound, unless the daemon is already on 31546.
5. Hosts the tunnel and prints its address.

If any step fails, the daemon keeps running without the tunnel.

It claims `protocolv5` and not 6, because protocol 6 clients also expect a selection gateway at `/agent-host/select`, which a plain port forward does not serve.

## Documentation

| | |
| --- | --- |
| [DAEMON.md](https://github.com/softov/ahpd/blob/main/docs/DAEMON.md) | Connection tokens and remote access |
| [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/PLUGINS.md) | Loading a plugin into the daemon |

## License

MIT © Softov
