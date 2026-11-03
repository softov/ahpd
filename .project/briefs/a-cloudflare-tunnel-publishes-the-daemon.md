---
title: A Cloudflare tunnel publishes the daemon
created: 2026-11-02
replaces:
  - ideas/a-cloudflare-tunnel-publishes-the-daemon.md
refs:
  - git://9d1cc04e - the commit of ahpd the facts were checked at
  - git://15f02030 - the commit of ahpd the tunnel kind and `tunnelHosts` facts were checked at
  - git://db244039 - the last commit that holds the idea this brief replaces
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L173-L186](../../packages/tunnel-devtunnel/src/plugin.ts#L173-L186) - the devtunnel plugin keeps what `listening` said and registers its kind"
  - "[code://packages/sdk/src/types/events.ts#L293-L302](../../packages/sdk/src/types/events.ts#L293-L302) - the `listening` event, with `guarded`"
  - "[code://packages/server/src/commands/run.ts#L140-L152](../../packages/server/src/commands/run.ts#L140-L152) - `announcedNames`, the URLs read out of `say` lines"
  - "[code://packages/server/src/commands/run.ts#L585-L605](../../packages/server/src/commands/run.ts#L585-L605) - the API's `Host` check, which reads the tunnels' URLs when `tunnelHosts` is on"
  - "[code://packages/sdk/src/types/plugin.ts#L1466](../../packages/sdk/src/types/plugin.ts#L1466) - `registerTunnelKind`, how a plugin adds a kind of tunnel"
  - "[code://packages/tunnel-devtunnel/src/kind.ts](../../packages/tunnel-devtunnel/src/kind.ts) - the devtunnel kind, the shape to copy"
  - plans/plugin/20261102-1122-the-host-keeps-the-tunnels/plan.md - the built plan that keeps the tunnels on the host and adds kinds
  - "[code://docs/plugins/PLUGINS.md#L98-L150](../../docs/plugins/PLUGINS.md#L98-L150) - how an option holds a credential, or names one in the vault"
  - https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/ - quick tunnels, read 2026-11-02
  - https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/cloudflared-parameters/run-parameters/ - `--token` and `--token-file`, read 2026-11-02
  - https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/remote-tunnel-permissions/ - who can run a tunnel with its token, read 2026-11-02
  - https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/methods/create/ - create a tunnel through the API, read 2026-11-02
  - https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/subresources/token/methods/get/ - read a tunnel's token, read 2026-11-02
  - https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/ - a `CNAME` to `<UUID>.cfargotunnel.com`, read 2026-11-02
  - https://developers.cloudflare.com/network/websockets/ - WebSockets on every plan, and idle closes, read 2026-11-02
  - file:///github/ahpd/.project/briefs/a-person-acts-from-a-plugin-page.md - actions on a plugin's page
  - file:///github/ahpd/.project/briefs/the-host-keeps-the-tunnels.md - the host's list of tunnels, which this plugin adds to
---

# A Cloudflare tunnel publishes the daemon

The goal is a `cloudflare` plugin that publishes the daemon through Cloudflare Tunnel, as `tunnel-devtunnel` does through Dev Tunnels.
A person behind a NAT gets an `https://` address for ahpw, ahpapp and the API.
Softov chose Cloudflare as the tunnel after Dev Tunnels, as one `cloudflare` plugin that can hold more Cloudflare features later (2026-10-26).
ngrok comes after it.

## What others do

Cloudflare runs a tunnel with the `cloudflared` program, in one of three ways.

| Mode | What the person gives | Address | Same address after a restart |
| --- | --- | --- | --- |
| Quick tunnel | Nothing: no account and no domain | A random `trycloudflare.com` name | No |
| Own account | An API token, and a domain on that account | A name they pick on the domain | Yes |
| A tunnel token | A token for a tunnel someone else made | The name that tunnel has | Yes |

Facts from Cloudflare's documents, read on 2026-11-02:

- `cloudflared tunnel --url http://localhost:8080` starts a quick tunnel.
- A quick tunnel takes at most 200 requests in flight, and answers `429` to more. It does not support Server-Sent Events.
- `cloudflared tunnel run --token <TUNNEL_TOKEN>` runs a tunnel made in the dashboard or the API. It reads the `TUNNEL_TOKEN` variable too. `--token-file <PATH>` reads the token from a file, from `cloudflared` 2025.4.0.
- "Anyone with access to the token will be able to run the tunnel."
- `POST /accounts/{account_id}/cfd_tunnel` makes a tunnel, and only `name` is required. Its answer holds no token.
- `GET /accounts/{account_id}/cfd_tunnel/{tunnel_id}/token` answers the token.
- A `CNAME` record to `<UUID>.cfargotunnel.com` points a name at the tunnel.
- WebSockets work on every plan. Cloudflare closes a WebSocket with no traffic for a period, and a restart of its servers ends open ones. It advises a ping from the client.
- TLS ends at Cloudflare's edge, so Cloudflare sees the traffic, the connection token included.

## What ahpd has today

- `tunnel-devtunnel` keeps what `listening` said and registers its kind ([`code://packages/tunnel-devtunnel/src/plugin.ts`](../../packages/tunnel-devtunnel/src/plugin.ts#L173-L186)). Its kind reads the daemon's port and `guarded` from it ([`code://packages/tunnel-devtunnel/src/kind.ts`](../../packages/tunnel-devtunnel/src/kind.ts)).
- devtunnel runs the Dev Tunnels SDK in-process and signs in with a device code. It needs no CLI, at git://15f02030.
- `listening` carries `guarded`, which says whether the daemon asks for a connection token ([`code://packages/sdk/src/types/events.ts`](../../packages/sdk/src/types/events.ts#L293-L302)).
- A URL in a `say` line during `listening` becomes a name the routes answer to ([`code://packages/server/src/commands/run.ts`](../../packages/server/src/commands/run.ts#L140-L152)).
- The host keeps a list of tunnels, and a plugin adds a kind of tunnel with `registerTunnelKind` ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L1466)). devtunnel is the first kind, at git://15f02030.
- The routes answer to every tunnel's URL. The API answers to them only when the daemon setting `tunnelHosts` is on, and it is off by default ([`code://packages/server/src/commands/run.ts`](../../packages/server/src/commands/run.ts#L585-L605)).
- An option holds a credential as `writeOnly`, or names a vault secret as `{ "$secret": "host:<name>" }` ([PLUGINS.md](../../docs/plugins/PLUGINS.md#L98-L150)).
- The daemon sends no WebSocket ping: no `ping(` call in `packages/*/src`.
- No plugin talks to Cloudflare.

## Who writes

| Writer | Files | What the change does to it |
| --- | --- | --- |
| The `plugin/canvas-example` branch | `examples/canvas/`, the `--plugin` change | No overlap |
| [a-person-acts-from-a-plugin-page.md](a-person-acts-from-a-plugin-page.md) | devtunnel actions | No overlap |
| [the-host-keeps-the-tunnels.md](the-host-keeps-the-tunnels.md) | The host's list of tunnels | This plugin provides a kind of tunnel to that list once it exists |
| `release/prerelease-channel` worktree | Release files | The new package joins the release list |

No open PR on softov/ahpd at the time of writing.

## The change

- A new package, `@ahpd/cloudflare`, with the tunnel as its first feature.
- An option `mode` picks the quick tunnel, the own account, or a tunnel token. Each mode has its own options.
- The plugin registers a `cloudflare` kind of tunnel. The host starts and stops each record, and the kind runs `cloudflared` toward the record's port.
- In own-account mode, the plugin makes the tunnel and its `CNAME` once, keeps the tunnel id, and reuses it on each start. Then it reads the token and runs as in token mode.
- The API token and the tunnel token are credentials, marked `writeOnly` or named from the vault.
- The kind reports each tunnel's URL to the host's list, so the routes answer to it.
- The plugin's page shows the mode, the URL and the state, as devtunnel's page does.
- The daemon pings every open WebSocket, as *Answers* says.
- The kind refuses to start a tunnel when `listening` says the daemon is not `guarded`. It raises an `error` alert on its row that says why.

## Answers

| Question | Answer |
| --- | --- |
| A public tunnel on a daemon with no connection token | Refuse. Softov, 2026-11-02: "For a public tunnel on a daemon with no connection token: refuse." |
| The tunnel is a kind of tunnel on the host's list, as devtunnel is. The kind runs `cloudflared` for each record | (defaulted: Softov, 2026-11-02, "Host owns it, plugins by kind", in [the-host-keeps-the-tunnels.md](the-host-keeps-the-tunnels.md)) |
| The API answers to the tunnel's URL when `tunnelHosts` is on. The plugin adds no name, and the person adds nothing to `origins` | (defaulted: plan `20261102-1122-the-host-keeps-the-tunnels` built `tunnelHosts`) |
| The daemon pings every open WebSocket on an interval. A daemon setting holds the interval, and 0 turns it off | Softov, 2026-11-02, chose "The daemon, a setting" |
| The plugin gives the tunnel token to `cloudflared` in the `TUNNEL_TOKEN` variable of its process | Softov, 2026-11-02, chose "TUNNEL_TOKEN variable" |
| Cloudflare Access comes later, in its own brief. The first plan is the tunnel alone | Softov, 2026-11-02, chose "Later" |
| How the plugin gets `cloudflared` | The person installs it. The plugin finds it on the PATH or at a path option, and raises an alert with the install link when it is missing. The plugin downloads nothing. Softov, 2026-11-02, chose "Person installs it" |

## Open points

None.
