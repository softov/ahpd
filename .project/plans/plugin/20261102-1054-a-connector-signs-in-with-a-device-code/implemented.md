---
title: A connector signs in with a device code - implemented
date: 2026-11-02
refs:
  - git://8c3da0a3 - the merge of ahpd #187
  - "[code://packages/sdk/src/types/connectors.ts#L342-L378](../../../../packages/sdk/src/types/connectors.ts#L342-L378) - `DeviceSignIn` and the `SignIn` union"
  - "[code://packages/sdk/src/connectors/channel.ts#L1100-L1210](../../../../packages/sdk/src/connectors/channel.ts#L1100-L1210) - the device start, poll and finish"
  - "[code://packages/sdk/src/connectors/channel.ts#L1340-L1380](../../../../packages/sdk/src/connectors/channel.ts#L1340-L1380) - `x-ahpd/connectors/secret`"
  - "[code://packages/tunnel-devtunnel/src/adapter.ts](../../../../packages/tunnel-devtunnel/src/adapter.ts) - the `devtunnel` adapter"
---

A person signs in to Dev Tunnels from a client with a code shown on screen, and no `devtunnel` CLI.
Each GitHub account is a `devtunnel` connector, and the connector keeps its token fresh by itself.
Any adapter can declare the device-code flow, and its plugin can write a refreshed secret back to its own connector.
ahpw draws the code, the provider's page and the wait, from softov/ahpw #35.

## What was built

- [`code://packages/sdk/src/types/connectors.ts`](../../../../packages/sdk/src/types/connectors.ts) - `SignIn` is `CodeSignIn | DeviceSignIn`, with the `account` field and `switchAccount`.
- [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts) - the device start, poll and finish, the account rule, `x-ahpd/connectors/secret`, and the `unauthorized` state.
- [`code://packages/sdk/src/plugins/validate.ts`](../../../../packages/sdk/src/plugins/validate.ts) - the registration check for the device shape.
- [`code://packages/tunnel-devtunnel/src/adapter.ts`](../../../../packages/tunnel-devtunnel/src/adapter.ts) - the `devtunnel` adapter: the device sign-in, the tunnels check, and the refresh at open and every 7 hours.
- [`code://packages/tunnel-devtunnel/README.md`](../../../../packages/tunnel-devtunnel/README.md) - the `allowAccountChange` option and the sign-in section.
- [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) - the device flow, the `secret` command and the `unauthorized` state.

## Verified

- `connectors-signin.test.ts` 22 cases, `connectors-channel.test.ts` 53, `plugin-validate.test.ts` 30, `tunnel-devtunnel-adapter.test.ts` 11.
- ahpd #187 passed its 11 CI checks, Windows included, before the merge.
- The sign-in with a real GitHub account, the restart after 8 hours, the management URL and the `scope` are not verified. They are in [plugin-1054-device-sign-in-checks.md](../../../pending/plugin-1054-device-sign-in-checks.md).

## Departures from the plan

- A connector whose check the provider refused, with 401 or 403, is `unauthorized`. A passing check or a new sign-in makes it `ready` again. The plan did not name this state.
- The adapter's own plugin asks for a check and sends a note with no grant, as it sends `secret`. The plan named this for `secret` only.
- A devtunnel check uses the token the open connector holds, and waits for a refresh that is still running. This stops a check at start from sending an expired token.
- Each task's *Resume* lists its own departures, such as the doc in the package README and the exports in `src/index.ts`.

## Left for later

- Which GitHub call answers the login for this app's token. The adapter uses `GET https://api.github.com/user`, and the pending checks confirm it.
- The refresh skips a connector whose token comes from `fromEnv`.
- The Microsoft sign-in, as *Answers* says.
