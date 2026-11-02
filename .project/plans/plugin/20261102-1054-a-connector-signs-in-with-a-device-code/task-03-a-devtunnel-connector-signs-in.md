---
title: A devtunnel connector signs in
status: todo
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
14. Write the doc section, with the `connector:put` and `connector:host` grants the plugin's connection needs.

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
