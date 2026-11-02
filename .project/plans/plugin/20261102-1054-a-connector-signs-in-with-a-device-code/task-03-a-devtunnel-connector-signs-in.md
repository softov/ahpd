---
title: A devtunnel connector signs in
status: done
depends:
  - task-01-a-sign-in-shows-a-code-and-waits.md
  - task-02-a-plugin-stores-a-refreshed-secret.md
layer: tunnel-devtunnel
refs:
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L97-L149](../../../../packages/tunnel-devtunnel/src/plugin.ts#L97-L149) - `apply` and the options, where the adapter registers"
  - "[code://packages/tunnel-devtunnel/package.json#L75-L76](../../../../packages/tunnel-devtunnel/package.json#L75-L76) - `contracts` and `optionsSchema`"
  - "[code://packages/agent-claude/src/plugin.ts#L161-L199](../../../../packages/agent-claude/src/plugin.ts#L161-L199) - `throughHost` and `registerAdapter`, the pattern for the plugin's own connection"
  - "[code://packages/agent-claude/src/adapter.ts#L25](../../../../packages/agent-claude/src/adapter.ts#L25) - a client id kept as a constant"
  - https://github.com/microsoft/dev-tunnels/blob/b73b0eb774b/ts/src/contracts/tunnelServiceProperties.ts#L111-L116 - the client id, `Iv1.e7b89e013f801f03`
  - https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app - the device code and token endpoints, and their errors
  - https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens - the refresh request
---

## Objective

The devtunnel plugin registers a `devtunnel` adapter that signs in with a GitHub device code.
The adapter checks the account against the Dev Tunnels API and keeps its token fresh.
The plugin keeps each open connector's token in memory by id, for the tunnel kind of the next plan.

## Files

- `CREATE: packages/tunnel-devtunnel/src/adapter.ts` - the `devtunnel` adapter: schema, device sign-in, check, open and refresh.
- `UPDATE: packages/tunnel-devtunnel/src/plugin.ts:97-149` - register the adapter, read `allowAccountChange`, and open the plugin's own connection as `throughHost` does.
- `UPDATE: packages/tunnel-devtunnel/package.json:75-76` - `contracts.adapters: ["devtunnel"]` and `allowAccountChange` in `optionsSchema`.
- `CREATE: packages/tunnel-devtunnel/test/tunnel-devtunnel-adapter.test.ts` - the adapter against a fake `fetch`.
- `UPDATE: docs/plugins/tunnel-devtunnel.md` - signing in with a connector, several accounts, the option, and the grants the plugin needs.

## Steps

1. Give the adapter a schema with `token` and `refresh` marked secret, and `account` as a plain string.
2. Keep `Iv1.e7b89e013f801f03` as a constant, with the SDK file it comes from in its comment.
3. In `signIn.start()`, post `client_id` to `https://github.com/login/device/code` and map the answer.
4. In `signIn.poll()`, post the device code to `https://github.com/login/oauth/access_token`.
5. Map `authorization_pending` to `{ wait }`, `slow_down` to `{ wait }` with 5 more seconds, and other errors to a refusal.
6. On a token, read the account's login and answer `{ token, refresh, account }`.
7. Set `account: 'account'` and `switchAccount` from the plugin option `allowAccountChange`, which is false by default.
8. In `check`, list the account's tunnels with `Authorization: github <token>`, and answer `denied` on 401 or 403.
9. In `open`, refresh the token at once, then every 7 hours, and stop on close.
10. Send the new token and refresh token with `x-ahpd/connectors/secret` before the plugin uses them.
11. On a failed refresh, log one line and ask the host to `check` the connector.
12. Keep each open connector's token in a map by id, and export a reader for it.
13. Keep the CLI path of the plugin as it is.
14. Write the doc section. The plugin's own connection needs no grant to send `secret`, as `ownPlugin` allows it.

## Validation

- `packages/tunnel-devtunnel/test/tunnel-devtunnel-adapter.test.ts` holds the device flow through pending, slow-down, approval and refusal, against a fake `fetch`.
- The same file holds: `check` answers `ok` on 200 and `denied` on 401.
- The same file holds: a refresh sends `secret` with both new values.
- The same file holds: no log line carries a token or a refresh token.
- `pnpm --filter @ahpd/tunnel-devtunnel test` passes.
- `pnpm typecheck` passes.
- By hand: a person signs in from a client, and the row is `ready`.
- By hand: after a restart 8 hours later, the row is still `ready`.
- By hand: confirm which call answers the GitHub login for this app's token, and record it in *Resume*.

## Resume

Built: `devtunnelAdapter` in `packages/tunnel-devtunnel/src/adapter.ts`, registered by `apply`. A device sign-in posts the app's client id to GitHub, shows the code, and polls with pending, slow-down and refusal mapped. On approval it reads the login from `GET https://api.github.com/user` and answers `{ token, refresh, account }`. `check` lists the account's tunnels at the Dev Tunnels management API with `Authorization: github <token>`. An open connector refreshes at once and every seven hours, and keeps its token in `OpenTunnels` by id. Both new values go through `x-ahpd/connectors/secret` before the token is used, and a failure logs one line and asks for a check. The plugin's own connection opens lazily and waits for `listening`, because a stored connector may open while the host is still being built. The manifest declares `contracts.adapters: ["devtunnel"]` and `allowAccountChange`, and the README has the options row and a sign-in section.

Departures:
- The doc edit is in `packages/tunnel-devtunnel/README.md`, not `docs/plugins/tunnel-devtunnel.md`: that file only includes the package README, so an edit there would be overwritten.
- `packages/tunnel-devtunnel/src/index.ts` exports the adapter, `OpenTunnels` and the URLs, so the next plan's tunnel kind can read the tokens. The task's Files did not list it.
- `OpenTunnels` is a small class rather than a bare map: `held(id)` is the reader, and `hold`/`release` belong to the adapter.
- `packages/server/test/plugin-load.test.ts` also lists the manifest's option keys, so its tunnel-devtunnel row gained `allowAccountChange`. The task's Files did not name it.
- The start request sends `scope=tunnels`, as the service's `gitHubAppScopes` names it. The management URL is `https://global.rel.tunnels.api.visualstudio.com/api/v1/tunnels`. No test can confirm either; they are in the pending checks below.

Pending by hand:
- A person signs in from a client, and the row is `ready`.
- After a restart 8 hours later, the row is still `ready`.
- The management URL and the `scope` the start sends, which only a real sign-in confirms.

Open question: which call answers the GitHub login. The plan proposed `GET https://api.github.com/user`, and the adapter uses it; it stays for the real sign-in to confirm.

Gates: `pnpm -s build` pass, `pnpm exec tsc -p tsconfig.json --noEmit` pass, `pnpm -s boundary` pass. `pnpm --filter @ahpd/tunnel-devtunnel test` 51 pass, of which 9 are the adapter's. The full run found the one option-key list above and nothing else; `plugin-load.test.ts` then passed all 59 of its cases.
