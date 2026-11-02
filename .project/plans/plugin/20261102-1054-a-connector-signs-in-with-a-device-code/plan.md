---
title: A connector signs in with a device code
domain: plugin
status: draft
priority: high
created: 2026-11-02
revalidated: 2026-11-02
requires:
  - plans/plugin/71-a-connector-signs-in-with-its-provider/plan.md
refs:
  - git://6e6d1ca8 - the commit of ahpd this plan was checked at
  - git://plugin/canvas-example - holds `.project/briefs/a-connector-signs-in-with-a-device-code.md`, the brief this plan covers, and `the-host-keeps-the-tunnels.md`, the next plan's brief
  - "[code://packages/sdk/src/types/connectors.ts#L272-L288](../../../../packages/sdk/src/types/connectors.ts#L272-L288) - `SignIn`, the pasted-code flow that gets a device-code sibling"
  - "[code://packages/sdk/src/types/connectors.ts#L299-L360](../../../../packages/sdk/src/types/connectors.ts#L299-L360) - `Adapter`, with `signIn?`, `open` and `check`"
  - "[code://packages/sdk/src/connectors/channel.ts#L623-L695](../../../../packages/sdk/src/connectors/channel.ts#L623-L695) - `ownerChecks` and `prepare`, which every sign-in runs, and which replace a record on an existing id"
  - "[code://packages/sdk/src/connectors/channel.ts#L763-L881](../../../../packages/sdk/src/connectors/channel.ts#L763-L881) - `signin` and `signin-finish`, the shape the device flow copies"
  - "[code://packages/sdk/src/connectors/channel.ts#L955-L990](../../../../packages/sdk/src/connectors/channel.ts#L955-L990) - `note`, the command only the adapter's plugin may send, which the secret command copies"
  - "[code://packages/sdk/src/connectors/channel.ts#L1054-L1062](../../../../packages/sdk/src/connectors/channel.ts#L1054-L1062) - the command table"
  - "[code://packages/sdk/src/connectors/adapters.ts#L68](../../../../packages/sdk/src/connectors/adapters.ts#L68) - the adapter row's `signIn`, which a client draws the button from"
  - "[code://packages/sdk/src/plugins/validate.ts#L686-L728](../../../../packages/sdk/src/plugins/validate.ts#L686-L728) - `checkSignIn`, which a plugin's adapter is held to at registration"
  - "[code://packages/agent-claude/src/plugin.ts#L161-L199](../../../../packages/agent-claude/src/plugin.ts#L161-L199) - `throughHost`: a plugin opens its own connection and sends `check` and `note`; the pattern the devtunnel adapter copies"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L97-L149](../../../../packages/tunnel-devtunnel/src/plugin.ts#L97-L149) - the devtunnel plugin's `apply` and options, which gets an adapter"
  - "[code://packages/tunnel-devtunnel/package.json#L75-L76](../../../../packages/tunnel-devtunnel/package.json#L75-L76) - its empty `contracts`, which gets `adapters`"
  - https://github.com/microsoft/dev-tunnels/blob/b73b0eb774b/ts/src/contracts/tunnelServiceProperties.ts#L111-L116 - the Dev Tunnels service's GitHub app client id, `Iv1.e7b89e013f801f03`
  - https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app - the GitHub device flow, read 2026-11-02
  - https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens - a refresh, with no client secret for a device-flow token, read 2026-11-02
  - https://datatracker.ietf.org/doc/html/rfc8628 - OAuth 2.0 Device Authorization Grant
---

## Goal

A person with no `devtunnel` CLI signs in to Dev Tunnels from a client, with a code shown on screen.
Each GitHub account they sign in with is a `devtunnel` connector, and a host may hold several.
The device-code flow is the connectors' own, so any adapter can use it after Dev Tunnels.
The connector keeps its token fresh by itself, and a dead connector signs in again under the same id.
The tunnels themselves do not change in this plan: the next plan makes a tunnel name its connector.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "device_code|deviceCode" packages/*/src` - no match. ahpd has no device-code flow.
- `rg -n "connectors/note" packages` - only agent-claude sends it, through `throughHost`.
- `rg -n "refresh" packages/agent-claude/src/adapter.ts` - no match. No adapter refreshes its key.
- A GitHub device sign-in with `Iv1.e7b89e013f801f03` on 2026-11-02 answered a token, and the Dev Tunnels management API listed the account's tunnels with `Authorization: github <token>`.
- A second sign-in on 2026-11-02 answered `expires_in=28800`, a `refresh_token`, and `refresh_token_expires_in=15638400`.

### Runtime path

```
client -> x-ahpd/connectors/signin { id, adapter: devtunnel, owner, config }
       -> adapter.signIn.start() -> { code, url, expires, interval, handle } -> host keeps handle, starts polling
       -> answers { state, code, url, expires }
person opens url, types code, approves on github.com
host -> adapter.signIn.poll(handle) every interval -> { values: { token, refresh, account } }
     -> owner checks again -> account check -> put -> vault connector/<id>/token, connector/<id>/refresh
client -> x-ahpd/connectors/signin-finish { state } -> waits -> connector row
devtunnel open -> refresh now and every 7 hours -> x-ahpd/connectors/secret { id, values } -> vault
```

### Gaps

- `SignIn` has only the pasted-code flow. Nothing shows a code and waits.
- A sign-in fills one secret field. A token and its refresh token are two.
- No plugin can write a new secret back to its own connector.
- The devtunnel plugin has no adapter and no sign-in. It needs the `devtunnel` CLI signed in by hand.

## Answers

| What | Source | Task |
| --- | --- | --- |
| This plan comes first, then the tunnel core, the list and the devtunnel kind | Softov, 2026-11-02: "Sign-in first" | - |
| The sign-in lives in a `devtunnel` connector, one per GitHub account, and a host may hold several | Softov, 2026-11-02: "A devtunnel connector" | 03 |
| `signin-finish { state }` waits until the approval or the expiry, and answers the row or the error. The host polls with or without a caller | Softov, 2026-11-02: "Finish waits for it" | 01 |
| A plugin stores a refreshed secret with `x-ahpd/connectors/secret`, sent as `note` is sent, by the adapter's plugin only | Softov, 2026-11-02: "A command, like note" | 02 |
| A second sign-in with a different GitHub account is refused. The plugin option `allowAccountChange` allows it | Softov, 2026-11-02: "Refuse, with a setting" | 01, 03 |
| The connector is written only after the approval. A sign-in on an existing id with the same owner replaces its secrets and keeps the id | Softov, 2026-11-02: "First user creates the connector after he authorizes right? So a token invalid could be reauthorized without needing to recreate the connector." | 01 |
| The devtunnel adapter uses the service's GitHub app, `Iv1.e7b89e013f801f03`, as a constant | (defaulted: the SDK names it for client apps; claude-login keeps its client id as a constant too) | 03 |
| A device-code sign-in is `SignIn` with `flow: 'device'`. A `signIn` with no `flow` stays the pasted code, so OpenRouter and claude-login do not change | (defaulted: no existing adapter moves) | 01 |
| A device-code sign-in answers several values. Each is a field of the schema: secret ones go to the vault, the rest stay in the record | (defaulted: a token and its refresh token are two secrets, and the account is not secret) | 01 |
| A device-code sign-in may name an `account` field. A second sign-in whose value differs is refused unless the adapter sets `switchAccount` | (defaulted: the host keeps the rule, so the next adapter gets it with no code) | 01 |
| A started device sign-in lives until the code expires, not 10 minutes, and counts toward the 10 kept for each caller | (defaulted: GitHub's code lasts 15 minutes) | 01 |
| The connector refreshes its token when it opens, and every 7 hours while open | (defaulted: a token lasts 8 hours, and a daemon that was down longer than that has an expired token) | 03 |
| Only the Microsoft sign-in waits for a later plan | (defaulted: the app it uses is not checked) | - |

## Proposed architecture

- **Data flow** - The adapter talks to GitHub. The host keeps the handle, polls, checks the owner and the account, and runs the put. A refreshed secret comes back from the plugin through `x-ahpd/connectors/secret`.
- **Event flow** - `signin` starts a poll timer. Each poll answers values, a wait, or a refusal. A refusal or the expiry ends the poll, and a waiting `signin-finish` answers the error.
- **State flow** - The started sign-in is in the host's memory only. The token and the refresh token are in the vault under `connector/<id>/<field>`. The account login is in the record.
- **Layer responsibilities** - sdk: the device flow, the account rule, the `secret` command and the registration check · tunnel-devtunnel: the `devtunnel` adapter, its refresh and its option.
- **Source-of-truth files** - [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts), [`code://packages/sdk/src/types/connectors.ts`](../../../../packages/sdk/src/types/connectors.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A sign-in shows a code and waits](task-01-a-sign-in-shows-a-code-and-waits.md) | implemented | - |
| [02 - A plugin stores a refreshed secret](task-02-a-plugin-stores-a-refreshed-secret.md) | todo | - |
| [03 - A devtunnel connector signs in](task-03-a-devtunnel-connector-signs-in.md) | todo | 01, 02 |

## Risks and tradeoffs

- A token, a refresh token or a device handle in a log gives away the account. No answer, row, error or log carries them. Only the code a person types is in an answer.
- A refresh makes the old refresh token stop working. The adapter sends `secret` before it uses the new token, and logs a failed send. A connector whose stored refresh token is dead answers `denied`, and the person signs in again.
- `signin-finish` holds a request open up to 15 minutes. The host keeps polling when the caller goes away, so a dropped request loses nothing.
- Polling calls the network every few seconds. The host stops polling at the expiry, at a refusal, and when the entry is dropped for being the oldest of a caller's 10.
- The devtunnel plugin's own connection needs `connector:put` and `connector:host` to send `secret` for a host connector. Its doc says so, and a refused send is one log line.

## Resume state

- **Done so far:** task 01 is built and its gates pass. It adds the `SignIn` union with the device flow, the host's start, poll and finish, and the adapter row's `flow`. The registration check is in place, with seven device cases in `connectors-signin.test.ts`, two registration cases in `plugin-validate.test.ts`, and `PLUGINS.md`.
- **Next action:** [task-02-a-plugin-stores-a-refreshed-secret.md](task-02-a-plugin-stores-a-refreshed-secret.md).
- **Departures:** the union makes `adapter.signIn` a `CodeSignIn | DeviceSignIn`, so two unlisted test files narrow it through a `signInOf` helper (`packages/agent-claude/test/agent-claude-login-adapter.test.ts`, `packages/server/test/openrouter-signin.test.ts`). A device finish's wait has its own timer at the code's expiry, and an expiry does not cut off a put that is already writing.
- **Open questions:**
  1. Which call answers the account's GitHub login for a token of this app - proposed: `GET https://api.github.com/user`, checked with a real sign-in in task 03.
- **Watch out for:** the finish must run the owner checks again with the starter's reader, as the pasted-code finish does. The device handle is a secret like the verifier.

## Final verification checklist

- [ ] A person signs in to Dev Tunnels from a client with a device code, and the `devtunnel` connector's row is `ready`.
- [ ] The vault holds `connector/<id>/token` and `connector/<id>/refresh`, and the record holds `account` and two `$secret` references.
- [ ] A daemon restarted after more than 8 hours opens the connector, refreshes its token, and the row is `ready`.
- [ ] A second sign-in on the same connector with the same account keeps the id. With another account it is refused, and with `allowAccountChange` it is accepted.
- [ ] No log line, error or row carries a token, a refresh token or a device handle.
- [ ] OpenRouter and claude-login still sign in with a pasted code.
