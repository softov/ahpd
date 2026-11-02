---
title: A connector signs in with a device code
created: 2026-11-02
refs:
  - git://3fd70b8e - the commit of ahpd the facts were checked at
  - "[code://packages/sdk/src/types/connectors.ts#L272-L288](../../packages/sdk/src/types/connectors.ts#L272-L288) - `SignIn`: a URL to open and a pasted code to exchange, the one flow an adapter has today"
  - "[code://packages/sdk/src/types/connectors.ts#L299-L360](../../packages/sdk/src/types/connectors.ts#L299-L360) - `Adapter`, with `signIn?`, `open` and `check`"
  - "[code://packages/sdk/src/connectors/channel.ts#L15-L43](../../packages/sdk/src/connectors/channel.ts#L15-L43) - the connector commands, the vault path of a secret, and `signin` and `signin-finish`"
  - "[code://packages/sdk/src/connectors/channel.ts#L757-L880](../../packages/sdk/src/connectors/channel.ts#L757-L880) - the host side of a sign-in: the verifier and the state kept ten minutes, then the exchange and the put"
  - "[code://packages/agent-claude/src/adapter.ts#L25](../../packages/agent-claude/src/adapter.ts#L25) - claude-login's client id, an adapter that signs in a person's own account"
  - "[code://packages/server/src/proxy/adapters.ts#L325-L350](../../packages/server/src/proxy/adapters.ts#L325-L350) - OpenRouter's sign-in, the first adapter with one"
  - "[code://packages/agent-claude/src/mcp.ts#L105-L116](../../packages/agent-claude/src/mcp.ts#L105-L116) - MCP finds an authorization server, but signs in nothing itself"
  - "[code://packages/sdk/src/agents/channel.ts#L20-L24](../../packages/sdk/src/agents/channel.ts#L20-L24) - a schema field marked `x-ahpd-connector` names a connector, and whose owner it may be"
  - "[code://packages/tunnel-devtunnel/src/devtunnel.ts#L47-L53](../../packages/tunnel-devtunnel/src/devtunnel.ts#L47-L53) - today's text: install the `devtunnel` CLI, then sign in with it"
  - https://github.com/microsoft/dev-tunnels/blob/b73b0eb774b/ts/src/contracts/tunnelServiceProperties.ts#L111-L116 - the Dev Tunnels service's GitHub app client id
  - https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app - the GitHub device flow, read 2026-11-02
  - https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens - token expiry and refresh, read 2026-11-02
  - https://datatracker.ietf.org/doc/html/rfc8628 - OAuth 2.0 Device Authorization Grant, the flow GitHub follows
---

# A connector signs in with a device code

A person who has never installed the `devtunnel` CLI signs in to Dev Tunnels from a client, with a code shown on screen.
Each signed-in GitHub account is a `devtunnel` connector, so a host can hold several accounts, and each tunnel names the one it uses.
The device-code flow belongs to the connectors, so any adapter can use it: Dev Tunnels first, MCP servers and others later.
Cloudflare comes later as a `cloudflare` adapter with its own sign-in.

## What others do

- The OAuth 2.0 device grant (RFC 8628) serves a client that cannot take a redirect.
  It shows a short code and a URL, and polls until the person approves.
- GitHub follows it for a GitHub App:
  - `POST https://github.com/login/device/code` with `client_id` answers `device_code`, `user_code`, `verification_uri`, `expires_in` and `interval`.
  - The codes last 900 seconds by default, and the default poll interval is 5 seconds.
  - `POST https://github.com/login/oauth/access_token` with the device code answers the token, or `authorization_pending`, `slow_down` (5 more seconds) or `expired_token`.
- When the app has token expiry on, the token lasts 8 hours and comes with a refresh token that lasts 6 months.
- A refresh takes `client_id`, `grant_type=refresh_token` and the refresh token. It needs no client secret when the token came from the device flow.
- A refresh answers a new token and a new refresh token, and the old ones stop working.
- The Dev Tunnels SDK names the service's GitHub app, `Iv1.e7b89e013f801f03`, for a client app to sign a person in with.

## What ahpd has today

- An adapter may declare a `signIn` with a `title`, a secret `field`, a `url(challenge, state)` and an `exchange(code, verifier)` ([`code://packages/sdk/src/types/connectors.ts`](../../packages/sdk/src/types/connectors.ts#L272-L288)).
- That flow is a PKCE code a person pastes back. No adapter can show a code and wait.
- `x-ahpd/connectors/signin` answers `{ url, state }` and keeps the verifier ten minutes. `x-ahpd/connectors/signin-finish` takes `{ state, code }`, exchanges it and runs the put ([`code://packages/sdk/src/connectors/channel.ts`](../../packages/sdk/src/connectors/channel.ts#L15-L43)).
- `signin` writes nothing. The record is written when the sign-in finishes, through the put ([`code://packages/sdk/src/connectors/channel.ts`](../../packages/sdk/src/connectors/channel.ts#L755-L815)).
- A put on an id that exists, with the same owner, replaces the record and keeps a secret sent blank ([`code://packages/sdk/src/connectors/channel.ts`](../../packages/sdk/src/connectors/channel.ts#L646-L695)).
- The put moves the secret to the vault under `connector/<id>/<field>` and hands it to the adapter's `open` ([`code://packages/sdk/src/connectors/channel.ts`](../../packages/sdk/src/connectors/channel.ts#L15-L28)).
- OpenRouter and claude-login use `signIn` ([`code://packages/server/src/proxy/adapters.ts`](../../packages/server/src/proxy/adapters.ts#L325-L350), [`code://packages/agent-claude/src/adapter.ts`](../../packages/agent-claude/src/adapter.ts#L25)). Neither refreshes its key.
- No adapter can write a new secret back to its own connector. A rotated refresh token has no place to go.
- MCP in agent-claude finds a server's authorization metadata, but no connector signs in to it ([`code://packages/agent-claude/src/mcp.ts`](../../packages/agent-claude/src/mcp.ts#L105-L116)).
- A schema field marked `x-ahpd-connector` names a connector of one adapter. A put is refused when that connector's owner is neither the record's nor the host ([`code://packages/sdk/src/agents/channel.ts`](../../packages/sdk/src/agents/channel.ts#L20-L24)).
- The devtunnel plugin has no adapter. It tells a person to install the CLI and sign in with it ([`code://packages/tunnel-devtunnel/src/devtunnel.ts`](../../packages/tunnel-devtunnel/src/devtunnel.ts#L47-L53)).
- On 2026-11-02 a GitHub device code with the service's app gave a token, and `GET https://global.rel.tunnels.api.visualstudio.com/tunnels?global=true&api-version=2023-09-27-preview` with `Authorization: github <token>` answered HTTP 200.
- On 2026-11-02 a second sign-in with that app answered `expires_in=28800` and a `refresh_token` with `refresh_token_expires_in=15638400`. The token lasts 8 hours and must be refreshed.

## Who writes

| Writer | Files | What this change does to it |
|---|---|---|
| `plugin/canvas-example` | `.project/briefs/the-host-keeps-the-tunnels.md` | Its sign-in answer points at this brief. A tunnel record gets a `connector` field |
| MayCXC's `plugin/54-webhook-real-senders` and the two `union-2026-10-30` branches | `packages/sdk/src/connectors/channel.ts`, `packages/sdk/src/types/connectors.ts` | They add `note` and `ConnectorRef`, which main already has. A sign-in change touches the same files, so merge them first |
| claude-login and OpenRouter adapters | their `signIn` | Unchanged: the pasted-code flow stays as it is |

## The change

- `SignIn` gets a second flow, a device code, beside the pasted code. An adapter declares one or the other.
- A device-code sign-in has a `title` and a secret `field`.
  Its `start()` answers the code, the URL, the expiry and the interval, and `poll(handle)` answers the key or "not yet".
- `x-ahpd/connectors/signin` on a device-code adapter answers `{ state, code, url, expires }`. The host keeps the handle in memory under the state, as it keeps a verifier.
- The host polls at the interval the adapter gave. When the person approves, it runs the put with the key in the field.
- `x-ahpd/connectors/signin-finish { state }` waits until the person approves or the code expires. It answers the row or the error.
- When the caller goes away, the host keeps polling, and the connector still appears in the list.
- The host writes the connector only after the approval. A code that expires or is refused leaves no record, as a pasted-code sign-in does today.
- A sign-in on an existing id with the same owner replaces the token and keeps the id. A tunnel that names the connector still finds it.
- The client offers that second sign-in when the connector's `check` answers `denied`, such as after the refresh token expires or the person revokes the app.
- The code is shown to the person, so it may be in the answer. The handle and the key are in no answer, row, error or log.
- An adapter may answer more than one secret from a sign-in, such as a token and a refresh token.
- `x-ahpd/connectors/secret { id, values }` replaces secrets of one open connector, so a refreshed token and its new refresh token reach the vault.
- Only the plugin that registered the connector's adapter sends it, as with `note`. It takes only fields the schema marks secret.
- The devtunnel plugin registers a `devtunnel` adapter with a device-code sign-in through the service's GitHub app.
- Its `check` lists the account's tunnels through the management API.
- Each `devtunnel` connector is one GitHub account. A host may hold several.
- A devtunnel tunnel record has a `connector` field marked `x-ahpd-connector: devtunnel`. A tunnel belongs to the host, so the field names a host connector.
- The devtunnel plugin keeps each open connector's token in memory by id, and its tunnel kind reads it from there.
- The `devtunnel` CLI text goes when the kind hosts through the SDK.

## Answers

| What | Source |
| --- | --- |
| The sign-in plan comes first, then the tunnel core, the list and the devtunnel kind | Softov, 2026-11-02: "Sign-in first" |
| The sign-in lives in a `devtunnel` connector, one per GitHub account | Softov, 2026-11-02: "A devtunnel connector" |
| `signin-finish` waits for the approval and answers the row or the error. The host polls with or without a caller | Softov, 2026-11-02: "Finish waits for it" |
| A plugin stores a refreshed secret with a command, as it sends `note` | Softov, 2026-11-02: "A command, like note" |

## Open points

1. Not checked: which app a Microsoft (Entra) sign-in uses for Dev Tunnels, and whether a `devtunnel` connector offers it too.
2. May a person's own `devtunnel` connector back a tunnel, or only a host connector, as the owner rule says today?
3. A second sign-in on a connector may come from a different GitHub account. The tunnels made under the first account are then out of the connector's reach. Does the adapter refuse the other account, or accept it?
4. An MCP server's sign-in follows its authorization metadata, with a client id each server gives or registers. Is that a later brief of its own?
