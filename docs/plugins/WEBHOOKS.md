# Webhooks

`@ahpd/webhook` gives a program outside the host a URL to call. A call reaches a bot, starts the automation its connector names, or fires the `webhook` trigger, and each endpoint has its own secret.

## The endpoint connector

An endpoint is a `webhook` connector: a JSON record in `<configDir>/connectors/<id>.json`, made from a client with `x-ahpd/connectors/put`. A hand-written `webhooks/<id>.md` file is no longer read.

| Field | What it is |
| --- | --- |
| `id` | The slug, and the last segment of the endpoint's URL |
| `title` | What a client prints for it. Optional |
| `owner` | `host`, `team:<team>` or `user:<id>`. The secrets are kept under that owner's scope |
| `config.bot` | The bot a call talks to, as `bot://<slug>`. An endpoint names `bot` or `automation`, not both |
| `config.automation` | The id of the automation a call starts, such as `ci-review`. Leave both it and `bot` out to fire the `webhook` trigger |
| `config.secret` | The value a caller proves itself with. The field is `writeOnly`, so it is kept in the vault and never in the record. For `meta`, it is the app secret its signature uses |
| `config.verifyToken` | The token Meta must send as `hub.verify_token` when it checks the URL. `writeOnly`, and required for `meta` |
| `config.auth` | How a caller proves itself, one of the schemes below. The default is `bearer` |
| `config.header` | The header the proof is in, for `header` and `hmac`. GitLab sends `x-gitlab-token` |
| `config.algorithm` | The hash an `hmac` uses: `sha256`, `sha1` or `sha512`. Required for `hmac` |
| `config.encoding` | How an `hmac` value is written: `hex` or `base64`. Required for `hmac` |
| `config.prefix` | Text before an `hmac` value, such as `sha256=` |
| `config.match` | The calls this connector takes. See [the match](#the-match) |
| `config.reply` | How a call to a bot is answered: `callback`, `sync` or `none`. The default is `none` |
| `config.callbackPrefix` | What every callback URL must start with: an `http` or `https` URL whose path ends in `/`. Required when `reply` is `callback` |
| `config.syncTimeoutSeconds` | How long a `sync` call waits, over the plugin option of the same name |

The bot fields belong to an endpoint with a bot: a config that names `reply`, `callbackPrefix` or `syncTimeoutSeconds` with no `bot` is refused, and so is a `reply` of `callback` with no `callbackPrefix`. The fields a connector may have are the `oneOf` alternatives of the adapter's schema, so a config that does not fit one of them is refused when it is saved.

```json
{
  "id": "ci",
  "adapter": "webhook",
  "owner": "host",
  "title": "CI",
  "config": {
    "bot": "bot://motion",
    "secret": "a-long-random-value",
    "reply": "callback",
    "callbackPrefix": "https://ci.example.com/hooks/"
  }
}
```

That object is the params of `x-ahpd/connectors/put`. A config that fails the adapter's schema, or that the adapter refuses to open, is answered with `-32602` and no connector is made. A `put` of an id that already exists closes the connector it had, writes the record and opens the new one.

The host writes `secret` and `verifyToken` to the vault as `host:connector/<id>/<field>`, `team:<team>/connector/<id>/<field>` or `user:<id>/connector/<id>/<field>`, and the record holds `{ "$secret": "<name>" }` in its place. A client sending the config again sends an empty field to keep the stored value. `ahpd vault list` shows the names.

A connector of an adapter no loaded plugin registers stays on disk and shows as `unavailable`, and one whose config no longer fits shows as `invalid`. A call to either answers 404, and so does one to a connector that is not ready yet.

## The call

An endpoint's URL is `/plugins/webhook/<id>` on the daemon's port, or on the routes listener when one is configured. A call is a `POST`; only a `meta` connector takes a `GET`, for its URL check.

A client builds that URL from the adapter's receive capability, whose `path` is `/plugins/webhook/{id}`: put the daemon's HTTP root, or the routes listener's, before it and the connector's id in place of `{id}`.

The route reads the body first, up to the plugin's `maxBodyBytes` (5 MiB by default), and then checks the proof over those bytes, so there is nothing a caller without proof can make this process hold. A body over the limit answers 413.

```bash
curl -X POST http://127.0.0.1:37537/plugins/webhook/ci \
  -H "Authorization: Bearer $CI_HOOK_TOKEN" \
  -H 'content-type: application/json' \
  -d '{ "thread": "pr-42", "text": "Review this pull request.", "callback": "https://ci.example.com/hooks/pr-42" }'
```

| Answer | When |
| --- | --- |
| 202 | The call reached its target. A call `match` does not take answers `{ "skipped": true }` and fires nothing |
| 400 | The body has a JSON content type and is not JSON, or a bot call has no thread or no text |
| 401 | The call is not proved with the endpoint's secret |
| 403 | A Meta `GET` sent the wrong `hub.verify_token` |
| 404 | No open connector answers for that id, or the path has more than one segment after the prefix |
| 405 | The method is not `POST`, or it is a `GET` on a scheme other than `meta` |
| 409 | A bot call could not be sent: the plugin may not read the bot, the read answered no chat, or the host refused the turn |
| 413 | The body is larger than `maxBodyBytes` |

## The schemes

Each connector names one scheme in `config.auth`. Every value is compared in a time that does not depend on where it differs, and a timestamped scheme refuses a call more than 300 seconds from the host's clock.

| `auth` | What the call must send |
| --- | --- |
| `bearer` | `Authorization: Bearer <secret>` |
| `header` | The header `config.header`, equal to `secret` |
| `query` | The query parameter `token`, equal to `secret` |
| `hmac` | The header `config.header`, equal to `config.prefix` followed by the HMAC of `config.algorithm` over the raw body, written as `config.encoding` |
| `github` | `X-Hub-Signature-256: sha256=<HMAC-SHA256 of the raw body>`, with `secret` as the key |
| `stripe` | `Stripe-Signature` with a `t` and at least one `v1`: the HMAC-SHA256 of `<t>.<raw body>` with `secret`, hex, within 300 seconds |
| `slack` | `X-Slack-Request-Timestamp` and `X-Slack-Signature: v0=<HMAC-SHA256 of v0:<timestamp>:<raw body>>`, with `secret` as the key, within 300 seconds |
| `standard` | `Webhook-Id`, `Webhook-Timestamp` and `Webhook-Signature: v1,<base64>`, where the value is the HMAC-SHA256 of `<id>.<timestamp>.<raw body>` and the key is `secret` without its `whsec_` prefix, base64-decoded, within 300 seconds |
| `meta` | `X-Hub-Signature-256` over the raw body on a `POST`, as `github`, and the `GET` handshake on the URL |
| `graph` | Every `clientState` in the body's `value` list equal to `secret`, and the `validationToken` handshake on the URL |

A `query` token ends up in proxy logs, browser history and `Referer` headers. Use it only for a sender that can send a token no other way.

The header the proof is read from is kept out of the data a run reads, and so are `authorization` and `cookie`.

### The handshakes

Some senders confirm the URL before they send anything.

- Meta sends a `GET` with `hub.mode=subscribe`, `hub.verify_token` and `hub.challenge`. The right token answers the challenge as `text/plain`, the wrong one answers 403, and nothing fires.
- Microsoft Graph sends a `POST` with `validationToken` in the query and no proof at all. The token is answered as `text/plain`, and nothing fires.
- Slack sends a `url_verification` call, signed like every other Slack call. Once the signature passes, its `challenge` is answered as `text/plain`, and nothing fires.

A handshake is not a notification: no automation runs and no bot turn starts.

## One connector for each sender

### GitHub

GitHub signs the raw body with the webhook secret you gave it, and sends `X-Hub-Signature-256`. Set `secret` to that value.

```json
{
  "id": "github",
  "adapter": "webhook",
  "owner": "host",
  "config": { "automation": "ci-review", "auth": "github", "secret": "the webhook secret GitHub holds" }
}
```

### Stripe

Stripe sends `Stripe-Signature`, which holds a timestamp and one or more signatures. Set `secret` to the endpoint's signing secret, the one that starts `whsec_`.

```json
{
  "id": "stripe",
  "adapter": "webhook",
  "owner": "host",
  "config": { "automation": "billing-review", "auth": "stripe", "secret": "whsec_..." }
}
```

### Slack

Slack sends `X-Slack-Request-Timestamp` and `X-Slack-Signature`, signed with the app's Signing Secret. Set `secret` to that value.

```json
{
  "id": "slack",
  "adapter": "webhook",
  "owner": "host",
  "config": { "automation": "triage-slack", "auth": "slack", "secret": "the app's Signing Secret" }
}
```

A Slack event arrives as an `event_callback`, which carries no `thread` or `text` for a bot turn. A Slack connector usually names an automation, and the automation reads `{{event.body.event.text}}` or whatever part of the event it means.

### GitLab

GitLab sends its Secret token in `X-Gitlab-Token`, as it is. That is the generic `header` scheme.

```json
{
  "id": "gitlab",
  "adapter": "webhook",
  "owner": "host",
  "config": { "automation": "ci-review", "auth": "header", "header": "x-gitlab-token", "secret": "the Secret token GitLab holds" }
}
```

### Shopify

Shopify signs the raw body and sends the base64 value in `X-Shopify-Hmac-Sha256`. That is the generic `hmac` scheme.

```json
{
  "id": "shopify",
  "adapter": "webhook",
  "owner": "host",
  "config": {
    "automation": "orders-review",
    "auth": "hmac",
    "header": "x-shopify-hmac-sha256",
    "algorithm": "sha256",
    "encoding": "base64",
    "secret": "the app's shared secret"
  }
}
```

### Standard Webhooks

Standard Webhooks is the format Svix, OpenAI and Anthropic send. It sends `Webhook-Id`, `Webhook-Timestamp` and `Webhook-Signature`, and the signing secret starts `whsec_`.

```json
{
  "id": "agent-events",
  "adapter": "webhook",
  "owner": "host",
  "config": { "automation": "agent-review", "auth": "standard", "secret": "whsec_..." }
}
```

### Meta

Meta confirms the URL with a `GET` carrying `hub.verify_token`, and signs each notification with the app secret. Set `secret` to the app secret and `verifyToken` to the token you gave Meta.

```json
{
  "id": "meta",
  "adapter": "webhook",
  "owner": "host",
  "config": { "automation": "page-review", "auth": "meta", "secret": "the app secret", "verifyToken": "the token you gave Meta" }
}
```

### Microsoft Graph

Graph confirms the URL with a `validationToken`, and puts your `clientState` on every change in a notification. Set `secret` to the `clientState` you made the subscription with.

```json
{
  "id": "graph",
  "adapter": "webhook",
  "owner": "host",
  "config": { "automation": "mail-review", "auth": "graph", "secret": "the clientState of the subscription" }
}
```

## The bodies

A call carries any body: JSON of any shape, a form, text, or nothing.

- A JSON content type is parsed as JSON, and a body that is not JSON under it answers 400.
- A body with any other content type that parses as JSON is JSON too, because senders exist that set no content type at all.
- `application/x-www-form-urlencoded` is its fields.
- Anything else is text, and no bytes at all is `null`.

## The event data

A run reads one object, whatever target the call took:

```json
{
  "connector": "github",
  "method": "POST",
  "body": { "ref": "refs/heads/main", "repository": { "full_name": "acme/api" }, "pusher": { "name": "ana" } },
  "headers": { "x-github-event": "push", "content-type": "application/json" },
  "query": {}
}
```

`connector` is the endpoint's id, `method` is the request's method, `body` is the parsed body, `headers` are the request's headers with lowercased names, and `query` is its query without `token`. A run names a field with a dotted path: `{{event.body.repository.full_name}}`, `{{event.headers.x-github-event}}`, `{{event.query.tenant}}`.

The proof header of the connector's scheme is kept out of `headers`, so a run cannot read the value its caller was checked with. `authorization` and `cookie` are kept out for every scheme, and the URL `token` is never in `query`.

A GitHub push run might read:

```markdown
The push to {{event.body.ref}} of {{event.body.repository.full_name}} by {{event.body.pusher.name}} is in. Review the new commits.
```

## The match

`match` on the connector selects the calls that reach whichever target it has. It maps a dotted path of the event data to a value or a list of values. Every path must hold one of its values, and a path the call does not hold blocks the call: "only production" has to mean only production.

```json
"match": {
  "headers.x-github-event": "push",
  "body.ref": ["refs/heads/main", "refs/heads/release"]
}
```

That connector takes only a GitHub `push` to `main` or `release`, on any target it names. A call it does not take answers 202 with `{ "skipped": true }` and fires nothing, because a sender retries a non-2xx answer.

## The targets

A connector has one of three targets, and `match` applies to all of them.

| The connector names | What a call does | The answer |
| --- | --- | --- |
| `bot` | Sends its text as a turn in the bot's chat | Depends on `reply`, see below |
| `automation` | Starts that one automation | 202 with `{ "connector": "<id>", "automation": "<id>" }` |
| Neither | Fires the `webhook` trigger | 202 with `{ "connector": "<id>" }` |

The owner rule covers both the link and the fire. A connector starts an automation only when both have the same owner, or when the connector is the host's. The host refuses the save on either side when the rule fails, and it checks the owner again at a fire, so one person's automation never reads another person's calls. `host` and `root:<host>` are the host for this rule.

The data's `connector` is the connector's id, set by the plugin, and no body field of that name changes it.

## A call to a bot

A call to a bot endpoint sends its text as a turn in the plugin's own chat with the bot. That is one chat for the endpoint: the caller names a thread, and every thread talks in it. The chat is the one a read of the bot answers the plugin, and the first call starts it.

A turn in that chat runs no model. It ends in the call that starts it, with no response part, so a call is answered with no `text` until the bot's own work can post into its chat.

The call is one of two shapes:

- A JSON body `{ "thread": "...", "text": "...", "callback": "..." }`.
- Any other body, which is the text as it came. The `thread` and `callback` come from the query: `/plugins/webhook/ci?thread=pr-42`.

A JSON body that has no string `text` is the second shape, so the whole body is the text.

The plugin keeps each thread in the `webhook-threads` collection, as the endpoint, the thread id, the session and the chat. Every thread of an endpoint holds the same session and chat, which is what a session started again under a new URI rewrites.

### The reply

| `reply` | What the call answers |
| --- | --- |
| `callback` | 202 with `{ thread, turn }` once the turn is sent. At the turn's end, the plugin posts `{ thread, turn, status, text, error }` to the call's `callback` URL |
| `sync` | 200 with `{ thread, turn, status, text, error }` at the turn's end, or 502 when the turn failed. When the turn runs longer than the timeout, 202 with `status: "running"`, and the turn goes on |
| `none` | 202 with `{ thread, turn }` once the turn is sent. This is the default, so a connector made with only `bot` and `secret` answers its calls |

`text` is the turn's `markdown` response parts, joined: what the bot said in it. A turn in a `bot-chat` has none until the bot posts into its chat, so `text` is empty. `status` is `complete`, `cancelled` or `error`. A turn that failed has `status: "error"` and the message of its error in `error`, which no other answer holds. A `sync` call answers a failed turn with 502, so a caller that reads only the HTTP status sees the failure. A cancelled turn answers 200.

A callback URL must start with the endpoint's `callbackPrefix`. The plugin compares the URL as `new URL` writes it, so `https://ci.example.com.evil.test/` does not pass the prefix `https://ci.example.com/`. Without this check, any caller could make the host post to any address. A `callback` reply with no `callbackPrefix` is refused when the connector is saved.

A callback that answers with a redirect is a failed callback. The plugin does not follow the redirect, and the daemon's log gets a problem line.

A `sync` call waits for `syncTimeoutSeconds`: the endpoint's field, or the plugin option, which is 60 by default.

```json
{
  "plugins": [
    { "name": "@ahpd/webhook", "options": { "syncTimeoutSeconds": 30, "maxBodyBytes": 1048576 }, "grants": ["bot:get", "bot:chat", "session:read", "session:create", "session:write"] }
  ]
}
```

| Answer | When |
| --- | --- |
| 400 | The call has no thread or no text, or its callback URL is missing or outside the prefix |
| 409 | The plugin may not read the bot, the read answered no chat for it, or the host refused the turn. The answer's `message` is the host's reason. A turn that the host does not echo in 10 seconds is not refused: the call goes on, and the daemon's log gets a problem line. The first two are also a problem in the daemon's log, and the chat refusal names the grants `bot:chat` and `session:create` |

### The grants

On a host with a users directory, the plugin acts as `plugin:webhook`, with the grants of its entry:

| Grant | What it is for |
| --- | --- |
| `bot:get` | Read the bot |
| `bot:chat` | Be answered a chat by it, which the read starts |
| `session:read` | Read the session's state, which names the chat, and the turn's text |
| `session:create` | Start a session for an owner, which a read of the bot does |
| `session:write` | Send the turn |

The chat is the plugin's own, started as the owner `plugin:webhook`, so `session:create` is asked of nobody here: it is in the list because those two are the grants the plugin's problem line prints when a read is answered no chat.

The plugin opens its connection when the daemon listens, and hears each turn's end from the host.

## The trigger

A connector that names neither `bot` nor `automation` fires the `webhook` trigger type, which the plugin offers. The type has one event, `call`, and its form asks for one required field, `connector`: the id of the endpoint whose calls wake it.

```markdown
---
title: Check a deploy
enabled: true
session:
  provider: claude
triggers:
  - id: t1
    kind: event
    type: webhook
    title: A deploy finished
    events:
      - id: call
    config:
      connector: deploys
---

The deploy of {{event.body.repo}} at {{event.body.ref}} finished. Check that the service is up.
```

The `connector` field is checked when the automation is saved: a connector this host does not serve is refused, and so is one whose owner the automation may not read. The plugin sets `connector` in every fire's data, so a call reaches only the automations of the endpoint it came to.

A key of the trigger's `config` and the fire's data are compared as JSON when both hold it. A config key the data does not hold never stops a run. The data is the event data above, so a field of the body is named `body.<field>`.

The run's origin keeps the data of the fire, so the body must carry no secret in a field a run reads. The proof headers and the URL token are already kept out. An automation call needs no grant.

## A public port

The webhooks can be on a public address while AHP and the API stay on loopback. The daemon key `routes` gives every plugin route a listener of its own, which serves nothing else:

```json
{
  "host": "127.0.0.1",
  "routes": { "port": 8443, "host": "0.0.0.0" },
  "origins": ["https://hooks.example.com"]
}
```

The routes listener checks the `Host` header like the daemon's port does. A caller that reaches it by a public name needs that name in `origins`. With `routes.port` set, `/plugins/*` answers 404 on the daemon's port. See [HOST.md](../sdk/HOST.md#configuration-keys).
