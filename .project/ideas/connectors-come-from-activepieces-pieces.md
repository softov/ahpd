---
title: A connector plugin runs Activepieces pieces, so Instagram and the rest are installed rather than written
created: 2026-10-06
---

Softov, 2026-10-06: "a plugin connector-activepieces", "no docker", with connections grouped "so I can enable like 2 instagram accounts for one agent. or 2 instagram account one for each agent".
A hosted service such as Composio holds the person's tokens in its own cloud, so it is not a choice here.
`@ahpd/connector-activepieces` would load Activepieces pieces from npm and run their actions as host tools, in the daemon, with no Activepieces server.

## What a piece is

Each Activepieces integration is an npm package, `@activepieces/piece-<name>`, one bundled file with no dependencies.
`@activepieces/piece-instagram-business@1.0.1` and `@activepieces/piece-facebook-pages@0.4.0` are on npm today.
A piece exports one object that describes itself:

| Member | What it holds | Instagram example |
| --- | --- | --- |
| `displayName`, `logoUrl` | The name and logo a client shows | `Instagram for Business` |
| `auth` | The auth kind and its fields: `OAUTH2`, `SECRET_TEXT`, `CUSTOM_AUTH` and others | `OAUTH2`, with Meta's `authUrl`, `tokenUrl` and 11 scopes |
| `_actions` | One entry per action, each with `props` and `run(context)` | `upload_photo`, `publish_carousel`, `get_account_insights` and 6 more |
| a prop | A typed input; a `DROPDOWN` prop has `options({ auth })` | `page`, a dropdown of the account's pages |
| `_triggers` | Webhook and polling triggers | not used here |

A probe on 2026-10-06 loaded the Instagram piece in plain Node and called `get_profile` with a context the probe made.
The action read only `context.propsValue` and called `graph.facebook.com` directly, which refused the fake token with a 401.
So the Activepieces engine is not needed to run an action.

## The words

- A **piece** is one installed `@activepieces/piece-*` package: one kind of connector.
- A **connection** is one account of one piece, with its credentials: two Instagram accounts are two connections.
- A **connector profile** is a named group of connections that a session uses.

"Profile" alone is taken by the machine profile in the container domain, so this one is always "connector profile".

## What the plugin would do

- **List the pieces.** Each installed piece is a connector kind, with its name, logo, auth kind and actions.
- **Draw the form.** The connection form comes from `piece.auth`, and a dropdown's choices come from its `options({ auth })`.
- **Keep the credentials.** A connection's token or secret goes in the vault through [`secret()`](../../packages/sdk/src/types/plugin.ts), under the scope rule of [a-secret-is-named-in-a-host-team-or-user-scope](../decisions/a-secret-is-named-in-a-host-team-or-user-scope.md).
- **Do OAuth itself.** The callback is a route on the daemon's listener, as [plugin 21](../plans/plugin/21-a-plugin-serves-an-http-route/plan.md) allows, and the plugin refreshes each token.
- **Offer the tools.** Each action of each connection in the session's connector profile becomes one tool, such as `instagram_shop__upload_photo`.
- **Report health.** A piece has no health call, so the plugin makes the state from three facts.
  They are token expiry, a failed refresh, and one cheap read action per piece.

The person registers their own Meta app once, and its client id and secret are plugin options.
That is the part Composio sells: its own approved OAuth app.
No tool can remove it, because Meta owns the API.

## What must be settled first

- **A piece turns off TLS checks for the whole process.** The bundled `FetchHttpClient.sendRequest` sets `process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"` on every request. In the daemon, every other HTTPS call would then skip certificate checks, model API calls included. The pieces have to run in a child process, with the variable pinned so a piece cannot set it.
- **A tool is offered to every session.** `registerTool` appends to `HostOptions.tools`, and a [`HostTool`](../../packages/sdk/src/types/host.ts) has no session filter. A connector profile needs tools bound to a session, which is a host change before it is a plugin. A session key from [a-plugin-may-contribute-a-session-key](../decisions/a-plugin-may-contribute-a-session-key.md) could name the connector profile, if a tool can read it at the call.
- **ahpd has no named agent or bot.** A session runs a provider for a person. "One account for each bot" needs to say what a bot is here: a session, an automation, a person, or a team.
- **The license of each piece.** The npm metadata of the Instagram piece has no `license` field. The community pieces are MIT in the Activepieces repository, and each piece the plugin uses has to be confirmed.

## Questions it leaves

- A new registration kind, `registerConnector`, as doop has in `packages/sdk/src/provider/connector.ts`, or a plugin built from tool, route and session-key registrations.
- Whether a connector profile belongs to a person, a team or the host, the same three scopes a secret has.
- How a piece is installed: by `ahpd plugin`, by the plugin's own command, or by naming the package in the plugin's options.
- Whether a dropdown prop is filled when the connection is made, such as the Instagram page, or chosen by the model at each call.
- Triggers, which would let an Instagram comment start a session, through [initiators-start-sessions.md](initiators-start-sessions.md).
