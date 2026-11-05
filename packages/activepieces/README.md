# @ahpd/activepieces

[![npm](https://img.shields.io/npm/v/%40ahpd%2Factivepieces)](https://www.npmjs.com/package/@ahpd/activepieces)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

Activepieces pieces as connectors for the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon. Each piece is an adapter. Each of its actions is a tool that the host offers to a session or a bot that binds a connector of it.

A connector of a piece is one account: a Resend connector is one Resend key, and two Slack connectors are two Slack workspaces. The host keeps each key in the vault, because every secret field says `secret`.

The pieces run in the engine, the process Activepieces runs piece code in, with no Activepieces server and no Docker. A piece bundles an HTTP client that turns off TLS checks for the process it runs in. The daemon starts one engine for the pieces and pins that setting there.

Part of [ahpd](https://github.com/softov/ahpd). The source is in [`packages/activepieces`](https://github.com/softov/ahpd/tree/main/packages/activepieces).

## Install

```bash
ahpd plugin install @ahpd/activepieces
ahpd restart
```

The pieces in the table below are dependencies of this package, so they arrive with it. A piece this package does not depend on is installed when its name is saved in `pieces`. The install goes into the plugin's own `installed/` folder, so a name that is not a dependency still arrives. Write a version after the name to pick one, as in `@activepieces/piece-postgres@0.5.1`; a name with no version installs the newest. The plugin says on its own row how each install ended, and a piece that still does not load is a warning there.

Update, remove and one-run flags are in [Plugins](https://github.com/softov/ahpd/blob/main/docs/server/PLUGINS.md).

## Options

In the configuration file, with three of the pieces named:

```json
{ "plugins": [{ "name": "@ahpd/activepieces", "options": { "pieces": ["@activepieces/piece-resend", "@activepieces/piece-telegram-bot", "@activepieces/piece-slack"] } }] }
```

| Option | Default | What it does |
| --- | --- | --- |
| `pieces` | - | The package of each piece the daemon offers, such as `@activepieces/piece-resend`. A version may follow the name, as in `@activepieces/piece-postgres@0.5.1`. Required, and at least one |
| `networkMode` | `STRICT` | Activepieces' `AP_NETWORK_MODE` for the engine: `STRICT` refuses every connection a piece makes to a private, loopback, link-local or multicast address, `UNRESTRICTED` refuses none |
| `ssrfAllowList` | none | Activepieces' `AP_SSRF_ALLOW_LIST`: the addresses and CIDR ranges a piece may reach under `STRICT`, such as `10.0.0.5` or `10.0.0.0/8` |
| `sandboxPropagatedEnvVars` | none | The variables of the daemon's environment the engine is given, by name, as Activepieces' `AP_SANDBOX_PROPAGATED_ENV_VARS`. A proxy or a certificate file a piece needs is listed here |

An adapter is named `ap-` and the piece's own name: `ap-resend`, `ap-telegram-bot` and `ap-slack`. The plugin declares the contract `ap-*`, so a client sees every adapter it loads.

## The pieces this package ships

| Piece | Package | Version | Auth | License |
| --- | --- | --- | --- | --- |
| Resend | `@activepieces/piece-resend` | 0.6.1 | `SECRET_TEXT`, one key | MIT |
| Telegram Bot | `@activepieces/piece-telegram-bot` | 0.9.1 | `SECRET_TEXT`, one bot token | MIT |
| Slack | `@activepieces/piece-slack` | 0.23.1 | `CUSTOM_AUTH`, a bot token and an optional user token | MIT |
| GitHub | `@activepieces/piece-github` | 0.11.0 | `CUSTOM_AUTH`, a GitHub App: app id, installation id and private key; or `SECRET_TEXT`, a personal access token | MIT |
| Linear | `@activepieces/piece-linear` | 0.9.1 | `SECRET_TEXT`, one API key | MIT |
| Jira Cloud | `@activepieces/piece-jira-cloud` | 0.6.1 | `CUSTOM_AUTH`, the site URL, an email and an API token | MIT |
| Discord | `@activepieces/piece-discord` | 0.8.0 | `SECRET_TEXT`, one bot token | MIT |
| WhatsApp Business | `@activepieces/piece-whatsapp` | 1.0.1 | `CUSTOM_AUTH`, an access token, the business account id and an optional app secret | MIT |
| Notion | `@activepieces/piece-notion` | 0.8.1 | `CUSTOM_AUTH`, an internal integration token | MIT |
| Airtable | `@activepieces/piece-airtable` | 0.9.2 | `SECRET_TEXT`, one personal access token | MIT |
| SMTP | `@activepieces/piece-smtp` | 0.5.0 | `CUSTOM_AUTH`, the host, port, TLS, and an optional email and password | MIT |
| SendGrid | `@activepieces/piece-sendgrid` | 0.6.3 | `SECRET_TEXT`, one API key; or `CUSTOM_AUTH`, an API key and its data residency | MIT |
| Stripe | `@activepieces/piece-stripe` | 0.9.0 | `SECRET_TEXT`, one secret key | MIT |
| HubSpot | `@activepieces/piece-hubspot` | 0.13.1 | `CUSTOM_AUTH`, a private app access token | MIT |

The versions are exact, and the versions `@activepieces/pieces-framework` at `0.32.0` describes. Each piece is in `packages/pieces/community/` or `packages/pieces/core/` of [github.com/activepieces/activepieces](https://github.com/activepieces/activepieces), which is MIT outside its `ee` folders. Slack, GitHub, Notion and HubSpot declare an OAuth2 connection beside the auth in the table, and this plugin offers only the auth in the table. An action that takes a file, such as Slack's file upload, takes it as a string: [An action that takes or writes a file](https://github.com/softov/ahpd/blob/main/docs/plugins/activepieces.md#an-action-that-takes-or-writes-a-file).

## A connector

```json
{
  "id": "mail",
  "adapter": "ap-resend",
  "owner": "host",
  "config": {
    "secret_text": "re_the_resend_key"
  }
}
```

Sent as the params of `x-ahpd/connectors/put`, that connector writes the key to the vault and keeps `{ "$secret": "<name>" }` in the record. A bot, or a session config key, that binds `mail` gets the tool `ap_resend_send_email`, and a call sends one email through the piece. A Slack connector with `botToken` and `userToken` gets `ap_slack_send_channel_message` and the rest of the piece's actions.

A connector carries the auth kinds Activepieces names `SECRET_TEXT`, one secret `secret_text`; `BASIC_AUTH`, a `username` and a secret `password`; and `CUSTOM_AUTH`, the piece's own fields. A piece that lists more than one of them is one adapter whose connector picks its kind with `type`, as a person picks the kind of an Activepieces connection: a GitHub connector is `{ "type": "SECRET_TEXT", "secret_text": "<token>" }` or `{ "type": "CUSTOM_AUTH", "appId": "...", "installationId": "...", "privateKey": "..." }`. An `OAUTH2` auth is not carried.

A connector is checked with the piece's own `validate`, Activepieces' credential check, where the piece has one: its row is `ok` when the piece takes the connection, and `denied` with the piece's words when it does not.

An action its piece marks for humans alone, with `audience: 'human'`, is not offered, as Activepieces hides it from agents. An adapter is described in the piece's own words, or by its name where it wrote none.

## What a piece runs

- An action runs in the engine with the connector's auth and the call's input, as Activepieces runs a single action outside a flow: its step is `step_1`, and `run.canPause` is false, so a waitpoint is refused in the engine's words. An action the piece lacks is refused as the engine refuses it, `Action not found for piece <package>@<version>`.
  The result comes back as the tool's answer, and a thrown error comes back as its message only.
- A call may run for 600 seconds, Activepieces' single action run timeout. One that runs longer fails, saying the action may have partially completed and is not to be run again blindly, and the engine stays up for the next one.
  An engine that exits starts again on the next call, five times, as VS Code restarts its agent host. After that, every call is refused: `The engine process stopped after 5 restarts.`
- A call's input is diagnosed, filled, made its props' types and validated as Activepieces makes an action run's, and refused in its words when it cannot run.
- The engine's environment is Activepieces' sandbox's: a home in the system's temporary folder, the network mode and allow list, and the variables `sandboxPropagatedEnvVars` names. Nothing else of the daemon's environment reaches a piece.
- Under `STRICT`, every connection a piece makes to an address that is not unicast fails with `SSRFBlockedError`, as in Activepieces' engine.
- An action may keep a value in `store`, and the engine keeps it on disk for that connector alone, in the scope the piece names.
- `files` writes into the session's attachments, a `Buffer` or a `Readable` of at most 25 MB, and answers the name a later `FILE` value takes.
- `connections` and `server` are not offered.
- Triggers, OAuth2 and file props wait for a later plan.

## Documentation

| | |
| --- | --- |
| [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/server/PLUGINS.md) | What a plugin is, and how a daemon loads one |

## License

MIT.
