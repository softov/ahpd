# @ahpd/tunnel-devtunnel

A [Dev Tunnel](https://aka.ms/devtunnels) plugin for [`ahpd`](https://github.com/softov/ahpd). It forwards the port the daemon bound through a Microsoft Dev Tunnel, labelled the way VS Code expects, so the daemon can be found and reached from a machine it shares no network with.

The daemon itself knows nothing about tunnels. This is a plugin because reaching the host is not the host's job, and because `devtunnel` is a separate .NET program that a host which never uses one should not have to know exists.

## What it needs

The [`devtunnel` CLI](https://aka.ms/devtunnels/download), installed and logged in:

```bash
devtunnel user login       # a Microsoft account
devtunnel user login -g    # or a GitHub one
```

## Use

```bash
npm i -g @ahpd/tunnel-devtunnel
ahpd --plugin @ahpd/tunnel-devtunnel
```

Or in the configuration file:

```json
{ "plugins": ["@ahpd/tunnel-devtunnel"] }
```

The daemon announces the tunnel beside its own address, so `ahpd status` carries it:

```
ahpd on ws://127.0.0.1:9187 (node), sessions in /work
tunnel sunny-otter-9k3 (dev82), port 31546
```

In VS Code, sign in to the same Dev Tunnels account and run **Agents: Connect to Remote Agent Host via Dev Tunnel**. Tunnel discovery requires being signed in; a direct WebSocket address does not, and is what **Agents: Add Remote Agent Host...** takes.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `name` | this machine's hostname | What the tunnel is called in a client's list |
| `keep` | `true` | Whether the tunnel outlives the daemon |
| `anonymous` | `false` | Whether somebody not signed in to this account may reach it |

```json
{ "plugins": [{ "name": "@ahpd/tunnel-devtunnel", "options": { "name": "dev82", "anonymous": true } }] }
```

`keep` is on by default because the tunnel's id is what a client derives its connection token from: a new tunnel on every start is a new token on every start, and every client pointed at the old one is pointed at nothing.

## The connection token

A client connecting over a tunnel does not ask anybody for a token and does not read one off the tunnel. It computes one from the tunnel's id - unpadded base64url of its SHA-256 - and presents it as `?tkn=`. Reaching the tunnel at all already required the Dev Tunnels access boundary, so the token is a value both ends can work out rather than a secret either has to carry.

A daemon on loopback with no connection token of its own admits it, which is the ordinary case and needs no configuration. A daemon started with `--connection-token` will refuse it, because the token a client presents over a tunnel is the derived one and not the daemon's. The plugin says which token that would be, on its own line, so the two can be made to agree:

```
tunnel token 4d8f...  - what a client presents over the tunnel; this daemon requires its own
```

## What it does on the way up

1. Finds the tunnel it made before, by a label of its own, or makes one.
2. Labels it `vscode-server-launcher` and `protocolv5`, which is what makes a client look at it.
3. Puts port 31546 on it, the well-known port the convention fixes.
4. Forwards 31546 on loopback to whatever port the daemon actually bound, unless the daemon is already on it. A Dev Tunnel maps a port number to the same number, so unless the two are made to meet they do not.
5. Hosts the tunnel, and says the address.

A failure at any of these costs the tunnel and not the daemon: the socket is already bound and anything on the machine can still reach it.

`protocolv5` is deliberate rather than dated. From protocol 6 a client expects the forwarded port to also serve a selection gateway at `/agent-host/select`, a registry that picks between several hosts behind one tunnel, which the tunnel CLI's own launcher provides and a plain port forward does not. Claiming 6 would advertise a route that is not there.

## License

MIT
