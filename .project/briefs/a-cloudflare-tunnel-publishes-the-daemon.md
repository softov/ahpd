---
title: A Cloudflare tunnel publishes the daemon
created: 2026-11-02
replaces:
  - ideas/a-cloudflare-tunnel-publishes-the-daemon.md
refs:
  - git://9d1cc04e - the commit of ahpd the facts were checked at
  - git://db244039 - the last commit that holds the idea this brief replaces
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L97-L260](../../packages/tunnel-devtunnel/src/plugin.ts#L97-L260) - the devtunnel plugin, the shape to copy"
  - "[code://packages/tunnel-devtunnel/src/devtunnel.ts#L57-L75](../../packages/tunnel-devtunnel/src/devtunnel.ts#L57-L75) - how it runs the `devtunnel` CLI, and the seams a test replaces"
  - "[code://packages/sdk/src/types/events.ts#L293-L302](../../packages/sdk/src/types/events.ts#L293-L302) - the `listening` event, with `guarded`"
  - "[code://packages/server/src/commands/run.ts#L140-L152](../../packages/server/src/commands/run.ts#L140-L152) - `announcedNames`, the URLs read out of `say` lines"
  - "[code://packages/server/src/commands/run.ts#L580](../../packages/server/src/commands/run.ts#L580) - the API's `Host` check, which reads only configured names"
  - "[code://docs/plugins/PLUGINS.md#L98-L150](../../docs/plugins/PLUGINS.md#L98-L150) - how an option holds a credential, or names one in the vault"
  - https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/ - quick tunnels, read 2026-11-02
  - https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/cloudflared-parameters/run-parameters/ - `--token` and `--token-file`, read 2026-11-02
  - https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/remote-tunnel-permissions/ - who can run a tunnel with its token, read 2026-11-02
  - https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/methods/create/ - create a tunnel through the API, read 2026-11-02
  - https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/subresources/token/methods/get/ - read a tunnel's token, read 2026-11-02
  - https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/ - a `CNAME` to `<UUID>.cfargotunnel.com`, read 2026-11-02
  - https://developers.cloudflare.com/network/websockets/ - WebSockets on every plan, and idle closes, read 2026-11-02
  - file:///github/ahpd/.project/briefs/a-person-acts-from-a-plugin-page.md - the host's list of addresses, and actions on a plugin's page
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
- `cloudflared tunnel run --token <TUNNEL_TOKEN>` runs a tunnel made in the dashboard or the API. `--token-file <PATH>` reads the token from a file, from `cloudflared` 2025.4.0.
- "Anyone with access to the token will be able to run the tunnel."
- `POST /accounts/{account_id}/cfd_tunnel` makes a tunnel, and only `name` is required. Its answer holds no token.
- `GET /accounts/{account_id}/cfd_tunnel/{tunnel_id}/token` answers the token.
- A `CNAME` record to `<UUID>.cfargotunnel.com` points a name at the tunnel.
- WebSockets work on every plan. Cloudflare closes a WebSocket with no traffic for a period, and a restart of its servers ends open ones. It advises a ping from the client.
- TLS ends at Cloudflare's edge, so Cloudflare sees the traffic, the connection token included.

## What ahpd has today

- `tunnel-devtunnel` starts its tunnel at `listening` and stops it at `stopping` ([`code://packages/tunnel-devtunnel/src/plugin.ts`](../../packages/tunnel-devtunnel/src/plugin.ts#L97-L260)). It runs the CLI through a `Runner` and a `Spawner` that a test replaces ([`code://packages/tunnel-devtunnel/src/devtunnel.ts`](../../packages/tunnel-devtunnel/src/devtunnel.ts#L57-L75)).
- It asks the person to install and sign in to the `devtunnel` CLI. It downloads nothing.
- `listening` carries `guarded`, which says whether the daemon asks for a connection token ([`code://packages/sdk/src/types/events.ts`](../../packages/sdk/src/types/events.ts#L293-L302)).
- A URL in a `say` line during `listening` becomes a name the routes answer to ([`code://packages/server/src/commands/run.ts`](../../packages/server/src/commands/run.ts#L140-L152)).
- The API answers only the names in `resource` and `origins` ([`code://packages/server/src/commands/run.ts`](../../packages/server/src/commands/run.ts#L580)). So the web UI and the API refuse a request through a tunnel name until a person adds it to `origins`.
- An option holds a credential as `writeOnly`, or names a vault secret as `{ "$secret": "host:<name>" }` ([PLUGINS.md](../../docs/plugins/PLUGINS.md#L98-L150)).
- The daemon sends no WebSocket ping: no `ping(` call in `packages/*/src`.
- No plugin talks to Cloudflare.

## Who writes

| Writer | Files | What the change does to it |
| --- | --- | --- |
| The `plugin/canvas-example` branch | `examples/canvas/`, the `--plugin` change | No overlap |
| [a-person-acts-from-a-plugin-page.md](a-person-acts-from-a-plugin-page.md) | The host's list of addresses, devtunnel actions | This plugin gives its address to that list once it exists |
| `release/prerelease-channel` worktree | Release files | The new package joins the release list |

No open PR on softov/ahpd at the time of writing.

## The change

- A new package, `@ahpd/cloudflare`, with the tunnel as its first feature.
- An option `mode` picks the quick tunnel, the own account, or a tunnel token. Each mode has its own options.
- The plugin starts `cloudflared` at `listening`, toward the bound port, and stops it at `stopping`.
- In own-account mode, the plugin makes the tunnel and its `CNAME` once, keeps the tunnel id, and reuses it on each start. Then it reads the token and runs as in token mode.
- The API token and the tunnel token are credentials, marked `writeOnly` or named from the vault.
- The plugin says the tunnel's URL during `listening`, so the routes answer to it.
- The plugin's page shows the mode, the URL and the state, as devtunnel's page does.
- The plugin refuses to start a tunnel when `listening` says the daemon is not `guarded`. It raises an `error` alert on its row that says why.

## Answers

| Question | Answer |
| --- | --- |
| A public tunnel on a daemon with no connection token | Refuse. Softov, 2026-11-02: "For a public tunnel on a daemon with no connection token: refuse." |

## Open points

1. Does the plugin download `cloudflared`, or ask the person to install it, as devtunnel does?
2. Does the plugin add its name to the API's names, or does the person add it to `origins`?
3. Does the daemon send WebSocket pings, and how often?
4. Does the token go to `cloudflared` as `--token`, which other processes on the machine can read, or as `--token-file`, which needs `cloudflared` 2025.4.0?
5. Cloudflare Access in front of the tunnel: in this plugin now, or later?
