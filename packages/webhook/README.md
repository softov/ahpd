# @ahpd/webhook

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fwebhook)](https://www.npmjs.com/package/@ahpd/webhook)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 1.0.0](https://img.shields.io/badge/AHP-1.0.0-0b7285)

Webhooks for the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon. A program outside the host calls a URL, and the call talks to a bot, starts the automation its connector names, or fires the `webhook` trigger.

Each endpoint is a `webhook` connector, and names its own vault secrets. A call passes only with the proof its endpoint's scheme names: a bearer token by default, one sender's own signature, a header or query token, or a generic HMAC.

Part of [ahpd](https://github.com/softov/ahpd). The source is in [`packages/webhook`](https://github.com/softov/ahpd/tree/main/packages/webhook).

## Install

```bash
ahpd plugin install @ahpd/webhook
ahpd restart
```

Update, remove and one-run flags such as `--plugin` are in [Plugins](https://github.com/softov/ahpd/blob/main/docs/server/PLUGINS.md).

## Options

In the configuration file, with every option set:

```json
{ "plugins": [{ "name": "@ahpd/webhook", "options": { "syncTimeoutSeconds": 60, "maxBodyBytes": 5242880 } }] }
```

| Option | Default | What it does |
| --- | --- | --- |
| `syncTimeoutSeconds` | `60` | How long a sync call waits for its turn to end, in seconds |
| `maxBodyBytes` | `5242880` | The most of a call body the plugin reads, in bytes. A larger body answers 413 |

## An endpoint

```json
{
  "id": "github",
  "adapter": "webhook",
  "owner": "host",
  "config": {
    "automation": "ci-review",
    "auth": "github",
    "secret": "the webhook secret GitHub holds"
  }
}
```

Sent as the params of `x-ahpd/connectors/put`, that connector answers `POST /plugins/webhook/github` for a GitHub delivery signed with its secret, and a call starts the `ci-review` automation. The secret is written to the vault, and the record holds `{ "$secret": "<name>" }` in its place. A config that names no `automation` and no `bot` fires the `webhook` trigger instead.

[WEBHOOKS.md](https://github.com/softov/ahpd/blob/main/docs/plugins/WEBHOOKS.md) describes the schemes, one example for each real sender, the event data a run reads, `match`, and the answers.

## Documentation

| | |
| --- | --- |
| [WEBHOOKS.md](https://github.com/softov/ahpd/blob/main/docs/plugins/WEBHOOKS.md) | The record, the call and the answers |

## License

MIT.
