# @ahpd/tunnel-devtunnel

[![npm](https://img.shields.io/npm/v/%40ahpd%2Ftunnel-devtunnel)](https://www.npmjs.com/package/@ahpd/tunnel-devtunnel)
[![CI](https://github.com/ahpio/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/ahpio/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 1.0.0](https://img.shields.io/badge/AHP-1.0.0-0b7285)

A [Dev Tunnel](https://aka.ms/devtunnels) plugin for the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon. It forwards the daemon's port through a Microsoft Dev Tunnel, labelled the way VS Code expects, so VS Code can find and reach the daemon from a machine on another network.

Part of [ahpd](https://github.com/ahpio/ahpd). The source is in [`packages/tunnel-devtunnel`](https://github.com/ahpio/ahpd/tree/main/packages/tunnel-devtunnel).

## Install

```bash
ahpd plugin install @ahpd/tunnel-devtunnel
ahpd restart
```

Update, remove and one-run flags such as `--plugin` are in [Plugins](https://github.com/ahpio/ahpd/blob/main/docs/server/PLUGINS.md).

### What it needs

A signed-in `devtunnel` connector, and one GitHub account to sign in with. The plugin talks to the Dev Tunnels service through its SDK, so the `devtunnel` CLI is not needed and does not have to be installed.

Set the connector's name as the plugin's `connector` option, and sign in to it in a client. Until then the plugin registers the kind but opens no tunnel of its own. [Signing in with a connector](#signing-in-with-a-connector) below has the steps.

## Options

In the configuration file, with one tunnel and the person it is for:

```json
{ "plugins": [{ "name": "@ahpd/tunnel-devtunnel", "options": { "connector": "dev03", "name": "dev03", "person": "user:ada" } }] }
```

`person` and `requireToken` are the two settings that decide who gets in, and [The tunnel kind](#the-tunnel-kind) has both. Every option is in the table.

| Option | Default | What it does |
| --- | --- | --- |
| `connector` | none | The `devtunnel` connector this host's own tunnel uses; absent, no system tunnel is opened |
| `name` | this machine's hostname | What the Dev Tunnel is called in a client's list, and how it is found. A configured name is normalized as VS Code normalizes one (lowercase, word characters and dashes, twenty at most) and the hostname is cleaned as VS Code and its CLI clean one, so `code tunnel` and this plugin give one machine the same name |
| `keep` | `true` | Whether the Dev Tunnel outlives the daemon |
| `anonymous` | `false` | Whether somebody not signed in to this account may reach the system tunnel |
| `person` | none | Who a visitor to the system tunnel is, as `user:` and the id the users directory holds them under. Presenting the tunnel's derived token gets that person's grants; a host with users and no person here refuses the token; a person whose record requires the issuer cannot be named, and the tunnel does not start |
| `requireToken` | `false` | Whether a visitor to the system tunnel must bring a token this host accepts. On, the derived token is never mapped, and VS Code over the tunnel cannot connect |
| `allowAccountChange` | `false` | Whether a second sign-in may replace a connector's GitHub account |

Keep `keep` on: a client derives its connection token from the Dev Tunnel's id, so a new tunnel on every start is a new token on every start.

No option holds a credential. A connector keeps its GitHub token in the vault, and the plugin signs in to the Dev Tunnels service with it.

## Signing in with a connector

A `devtunnel` connector is one GitHub account, signed in with a device code. In a client, make a connector of the `devtunnel` adapter and press **Sign in with GitHub**. The host shows a code and a URL, and you approve on `github.com` from any device. The connector's row is `ready` once the host holds the token, and `unauthorized` while the service refuses it, until you sign in again. Each GitHub account gets its own connector, so one host may hold several.

A second sign-in on an existing connector from the same account keeps it. From another account it is refused, because a connector is one account. Set `allowAccountChange` to `true` to let a sign-in replace the account instead.

The token lasts eight hours. The plugin refreshes it when the connector opens, then keeps it alive as VS Code's CLI does: again at two thirds of the lifetime GitHub gives the new token, or an hour on when GitHub gives none. Each new pair is written to the vault through `x-ahpd/connectors/secret`. A refresh that fails logs one line and asks the host to check the connector, which then says on its row what the service answered; it is tried again in ten seconds, unless GitHub answered with a 4xx, which ends the refreshing until you sign in again.

A sign-in that polls too soon is told so by GitHub's `slow_down` or by a 429, and either adds five seconds to the wait, as VS Code's CLI does.

The plugin needs no grant for that: the host lets the plugin that registered an adapter write the secrets of that adapter's connectors and ask for their check, whoever owns them.

The Dev Tunnels service is reached with that token through the SDK, for the ports this plugin hosts and for the state on its page. Nothing is read from the `devtunnel` CLI's own login, and the CLI is not needed.

## The tunnel kind

The plugin registers one tunnel kind, `devtunnel`, and the host adds the one tunnel a client reaches: the system tunnel on port 31546, the fixed port VS Code looks for. One tunnel is enough. Its public URL is the Dev Tunnel's address, and its two settings decide who gets in.

- With `person` set, VS Code connects over the tunnel, and every visitor who presents the tunnel's derived token gets that person's grants. `person` is `user:` and the id the users directory holds them under, as in `"person": "user:ada"`. A host with no users needs no person: the derived token is accepted as it is, or given the daemon's own token when the daemon requires one.
- With `requireToken` on, a visitor brings a token this host accepts, as `?tkn=<token>` in the URL. VS Code cannot connect that way, because it presents only the derived token.
- On a host with users and neither set, the derived token is refused: the request is answered with a 401 and never reaches the daemon, and the tunnel's row says to set `person`. Only a person's own token gets in.

A saved change of `person` or `requireToken` takes effect on the running tunnel. A person whose record requires the issuer cannot be named: no key is minted for them, the row reports an error saying the tunnel needs another person, and the tunnel does not start.

A tunnel on another port is not a way to get a public URL for the daemon: it forwards that port as it is, with no token mapping, so a visitor gets whatever that port offers. When it is anonymous and that port has no sign-in of its own, anyone with the URL gets in, so leave `anonymous` off unless you mean it.

The host keeps the system tunnel as a record of the kind: the connector, port 31546, and one of the two settings. Starting a record puts its port on its connector's Dev Tunnel and asks the relay to serve it. Stopping it takes the port off. Two records of one connector are two ports on that connector's one Dev Tunnel, and one relay host serves both. A connector's Dev Tunnel is found as VS Code's CLI finds the tunnel it hosts: by the id the plugin kept for the connector, else by its name with the `vscode-server-launcher` label, so a restart reuses it and keeps its id, and with it every client's token. A tunnel of that name another machine is hosting is refused with the CLI's words. A port is written with the protocol `auto`, and a private one carries an anonymous deny, so a public default on the tunnel does not open it.

The kind offers `start`, `stop`, `restart` and `anonymous`. `restart` connects the relay to the same Dev Tunnel again without removing a port, which is what to try when the relay dropped. `anonymous` takes `{ "on": true }` or `{ "on": false }` and changes who may reach the port live, and the host saves it in the record.

A record whose connector is not open is not started: its row reports an error asking you to sign in to the connector again, and stays, because a sign-in is the next thing you will do.

With `keep` set to `false`, the last port stopping deletes the Dev Tunnel. The next start makes a new one with a new id, so every client derived a token for a tunnel that no longer exists and has to find the new one. Keep it on unless you mean that.

## In your own host

The package's `apply` is the plugin entry. Hand it a plugin host from `@ahpd/sdk` and fold what it registered into the host's options. The plugin does its work on the `listening` and `stopping` events, which the daemon raises and an embedding host raises itself:

```ts
import { createHost, foldHostOptions, listen, pluginHost, raise } from '@ahpd/sdk';
import { claude } from '@ahpd/agent-claude';
import { apply, name } from '@ahpd/tunnel-devtunnel';

const path = process.cwd();
const context = { path, paths: [path], version: '0.10.0', hostName: 'my-host', configDir: '/var/lib/my-host', log: console.log, say: console.log };
const { host: plugin, contribution, seal } = pluginHost(name, context);
await apply(plugin, { name: 'dev03', keep: true });
seal();

const { options } = foldHostOptions({ path, agents: [claude({ paths: [path] })] }, [contribution]);
const host = createHost(options);
const listener = await listen({ port: 9187 }, (peer) => host.accept(peer));
const { runtime, host: address, port, guarded } = listener;
await raise(options.events, { type: 'listening', runtime, host: address, port, guarded });

// On the way down, before the listener closes:
await raise(options.events, { type: 'stopping' });
await listener.close();
```

## In VS Code

The daemon prints the tunnel beside its own address, and `ahpd status` shows it:

```
ahpd on ws://127.0.0.1:9187 (node), sessions in /work
tunnel sunny-otter-9k3 (dev03), port 31546
```

In VS Code, sign in to the same Dev Tunnels account and run **Agents: Connect to Remote Agent Host via Dev Tunnel**. Finding a tunnel needs that sign-in. A direct WebSocket address does not, and is what **Agents: Add Remote Agent Host...** takes.

This is the way in when the tunnel sets `person`. With `requireToken` on, VS Code presents only the derived token, which the daemon does not accept, so it cannot connect.

## The connection token

A client connecting over a tunnel computes its token from the tunnel's id, as the unpadded base64url of its SHA-256, and presents it as `?tkn=`. Anyone who knows the tunnel's id can compute it, and on an anonymous tunnel anyone can reach it, so the token is not a secret. What the host does with it is the tunnel's setting, and [The tunnel kind](#the-tunnel-kind) has the three cases.

No local port listens for the tunnel. The relay hands each connection to the daemon's own process, which reads the request there and carries it to the daemon over a loopback dial, so nothing on this machine accepts a connection on the tunnel's port unless the daemon itself is bound to it (as VS Code's CLI takes its agent host's port in its own process). The port is still 31546 on the reverse-proxy side, which is the one VS Code looks for.

A guarded daemon the plugin was not handed a token for still has the derived token printed on its own line, so you can make the two agree:

```
tunnel token 4d8f...  - what a client presents over the tunnel; this daemon requires its own
```

## The plugin's page

A client that reads `x-ahpd-plugins` draws this plugin's row as a page: a card with the tunnel's address as a link, then the tunnel id, the port, whether the relay holds the tunnel, and how many clients are connected. The plugin reads that state through the Dev Tunnels SDK when the system tunnel starts and every 30 seconds after, and draws the page again only when the state changed.

A read that fails keeps the page as it was, and the plugin logs the first failure of a run of them and warns on the row. The next good read takes the warning away. When the tunnel stops, the page is cleared. The page's words come in Portuguese or Spanish from the plugin's own catalogs.

## What the system tunnel does at startup

With the `connector` option set, the host adds one system tunnel of the `devtunnel` kind and starts it when the daemon starts listening:

1. Finds the connector's Dev Tunnel by the id kept for it, else by its name with the launcher label, or makes one.
2. Labels it with its name, `protocolv5` and `vscode-server-launcher`, which is what makes a client list it, and keeps its id for the next start.
3. Puts port 31546 on it, the fixed port VS Code looks for.
4. Carries each connection on 31546 to the port the daemon bound, in the daemon's own process, with no local listener.
5. Hosts the Dev Tunnel and prints its address.

If any step fails, the daemon keeps running without the tunnel.

It claims `protocolv5` and not 6, because protocol 6 clients also expect a selection gateway at `/agent-host/select`, which a plain port forward does not serve.

## Documentation

| | |
| --- | --- |
| [REMOTE.md](https://github.com/ahpio/ahpd/blob/main/docs/server/REMOTE.md) | Connection tokens and remote access |
| [PLUGINS.md](https://github.com/ahpio/ahpd/blob/main/docs/plugins/PLUGINS.md) | Loading a plugin into the daemon |

## License

MIT © Softov
