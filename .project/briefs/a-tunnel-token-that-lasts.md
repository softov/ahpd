---
title: A tunnel token that lasts
created: 2026-11-02
refs:
  - git://f419294d - the commit of this repository the facts were checked at
  - "[code://packages/tunnel-devtunnel/src/adapter.ts#L272-L281](../../packages/tunnel-devtunnel/src/adapter.ts#L272-L281) - `refreshed`, which trades the refresh token for a new pair"
  - "[code://packages/tunnel-devtunnel/src/adapter.ts#L291-L305](../../packages/tunnel-devtunnel/src/adapter.ts#L291-L305) - the connector's `token` and `refresh` fields, both secret"
  - "[code://packages/tunnel-devtunnel/src/adapter.ts#L340-L406](../../packages/tunnel-devtunnel/src/adapter.ts#L340-L406) - `open`, which refreshes at once and then every `REFRESH_MS`"
  - "[code://packages/tunnel-devtunnel/src/service.ts#L258](../../packages/tunnel-devtunnel/src/service.ts#L258) - every management call goes out as `github <token>`"
  - "[code://packages/sdk/src/connectors/channel.ts#L15-L24](../../packages/sdk/src/connectors/channel.ts#L15-L24) - a host connector's secret field may hold `{ \"fromEnv\": \"<NAME>\" }`"
  - "[code://packages/sdk/src/access/vault.ts#L85-L91](../../packages/sdk/src/access/vault.ts#L85-L91) - `fromEnvRef`"
  - npm://@microsoft/dev-tunnels-contracts@1.3.61 - `TunnelAuthenticationSchemes` and `tunnelServiceProperties`, the schemes and the app ids the service names
  - https://learn.microsoft.com/azure/developer/dev-tunnels/security - tunnel access tokens, their four kinds and their 24 hours, read on 2026-11-02
  - https://learn.microsoft.com/azure/developer/dev-tunnels/cli-commands - `devtunnel user login` and `devtunnel token`, read on 2026-11-02
  - https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens - the eight hours and the six months, read on 2026-11-02
  - https://github.com/microsoft/dev-tunnels/issues/686 - a request for long-lived API keys, closed by its author with no reply
---

# A tunnel token that lasts

Softov wants to know which token the Dev Tunnels service accepts that lasts without a person.
A `devtunnel` connector can then take that token from `fromEnv`, so a host signs in with no device code.
Softov, 2026-11-02: find the token first, in a brief; decide `fromEnv` after it.

## What others do

The Dev Tunnels service names four schemes in `TunnelAuthenticationSchemes`: `aad`, `github`, `tunnel` and `tunnelplan`.

| Token | Who issues it | How long it lasts | Without a person |
|---|---|---|---|
| GitHub app user token | GitHub, to the Dev Tunnels app `Iv1.e7b89e013f801f03` | 8 hours | Yes, with its refresh token, for six months |
| GitHub app refresh token | the same | 6 months, and it works once | Each use gives a new one, which must be kept |
| Tunnel access token (`host`, `connect`, `manage ports`, `manage`) | the service, with `devtunnel token` | 24 hours | No. Only a user with `manage` access to the tunnel gets a new one |
| Entra token | Microsoft Entra ID, for the service app `46da2f7e-b5ef-422a-88d4-2a7f9de6a0b2` | Not checked | Not checked |
| GitHub personal access token | GitHub | Up to what the person sets | Not documented |

- The `devtunnel` CLI signs in with a browser or a device code, for a Microsoft account or a GitHub account. Microsoft documents no token option for `devtunnel user login`.
- The CLI's login token "is valid for several days before expiration".
- A tunnel access token is limited to one tunnel. "Tokens can only be refreshed using an actual user identity that has manage-scope access to the tunnel."
- Issue #686 asks for long-lived API keys. It says the GitHub login has only interactive flows, and lists service principal, federated token and managed identity options for Entra. Microsoft's docs do not list those options, and nobody from Microsoft replied.
- VS Code and the `devtunnel` CLI sign in with the same GitHub app as ahpd.

## What ahpd has today

- A connector holds `token` and `refresh`, both secret, at [`code://packages/tunnel-devtunnel/src/adapter.ts`](../../packages/tunnel-devtunnel/src/adapter.ts#L291-L305).
- The device sign-in answers both, and an open connector refreshes at once and every seven hours.
- [`refreshed`](../../packages/tunnel-devtunnel/src/adapter.ts#L272-L281) gets a new pair, and the pair is written back to the vault before the token is used.
- Every management call sends `github <token>`, at [`code://packages/tunnel-devtunnel/src/service.ts#L258`](../../packages/tunnel-devtunnel/src/service.ts#L258).
- A host connector's secret field may hold `{ "fromEnv": "<NAME>" }`, at [`code://packages/sdk/src/connectors/channel.ts`](../../packages/sdk/src/connectors/channel.ts#L15-L24). The host reads the variable when it opens the connector.
- A refresh token from `fromEnv` works once. After the first refresh, the new pair goes to the vault and the variable holds a token that GitHub no longer accepts. So a restart that reads the variable again fails.

### How the refresh runs

Softov asked on 2026-11-02 whether the eight hours are only a matter of the refresh.
While the daemon runs, the GitHub app pair needs no new sign-in for six months.
The refresh in [`open`](../../packages/tunnel-devtunnel/src/adapter.ts#L340-L406) has three gaps that can stop a tunnel before that.

| Gap | What the code does | What a person sees |
|---|---|---|
| A refresh fails | It logs the error and asks the host to check the connector, at [`code://packages/tunnel-devtunnel/src/adapter.ts#L392-L393`](../../packages/tunnel-devtunnel/src/adapter.ts#L392-L393). The next try is the next interval, seven hours later. | The token expires one hour after the failure, and the tunnel can stay down for about six hours. |
| The machine sleeps | `setInterval` counts [`REFRESH_MS`](../../packages/tunnel-devtunnel/src/adapter.ts#L83) on the clock of the event loop, at [`code://packages/tunnel-devtunnel/src/adapter.ts#L398`](../../packages/tunnel-devtunnel/src/adapter.ts#L398). Nothing refreshes on wake. | A host that wakes after a long sleep can hold an expired token until the next interval. |
| The service answers 401 | The token callback in [`code://packages/tunnel-devtunnel/src/service.ts#L258`](../../packages/tunnel-devtunnel/src/service.ts#L258) gives the token it holds. Nothing refreshes and sends the call again. | A call with an expired token fails, and the connector waits for the timer. |

- GitHub answers `expires_in` and `refresh_token_expires_in` with each pair. [`refreshed`](../../packages/tunnel-devtunnel/src/adapter.ts#L272-L281) keeps only the two tokens, so the code does not know when the token expires.
- Two cases are not gaps of the refresh. A daemon that is off for more than six months needs a new sign-in. A refresh token from `fromEnv` works once, as *What ahpd has today* says.

## Who writes

- Another session works in `/github/ahpd` on `main` and writes `.project/working/HANDOFF.md`.
- The branch `plugin/20261102-1054-a-connector-signs-in-with-a-device-code` does not touch `packages/tunnel-devtunnel`, `connectors/channel.ts` or `vault.ts`.
- PR #192 touches `invokeOperation`, not the `devtunnel` package.

## The change

No token is chosen yet.
The facts show these paths:

- The GitHub app pair stays the token. It lasts while the daemon refreshes at least once in six months. The vault keeps each next pair. A `fromEnv` seed of it is not enough, as *Answers* says.

Whichever path is chosen, the refresh closes the gaps in *How the refresh runs*:

- The refresh runs before the token's `expires_in`, not on a fixed interval.
- A failed refresh tries again within minutes, while the token still works.
- A host that wakes refreshes a token near or past its expiry.
- A call that the service answers with 401 refreshes once and is sent again.
- A GitHub personal access token, sent as `github <token>`. This works only if the service accepts a token that its app did not issue, which is not documented.
- An Entra service principal, sent as `aad <token>`. This needs an Entra tenant and an app registration, and the service's acceptance of a service principal is not checked.

## Answers

| What | Source |
| --- | --- |
| A `fromEnv` seed of the GitHub app pair is not enough. The device code stays the only sign-in until the service is seen to accept a token that does not rotate, such as a GitHub personal access token or an Entra service principal | Softov, 2026-11-02, chose "Not enough, wait" |

## Open points

- Whether the service accepts a GitHub personal access token under the `github` scheme. This needs one call to the management API with a real token.
- Whether the service accepts an Entra service principal token, and which audience it asks for.
- Whether the gaps in *How the refresh runs* stopped a real tunnel. No tunnel was seen to stop yet, and the check by hand is in [plugin-1122-tunnel-checks.md](../pending/plugin-1122-tunnel-checks.md).
- Whether the clock of the event loop stops while a Linux machine sleeps. This needs a check on a real machine.
- Whether a relay host that is connected needs a valid token, or only a new connection needs one.
