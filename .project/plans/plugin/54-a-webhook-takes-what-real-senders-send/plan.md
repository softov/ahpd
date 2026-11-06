---
title: A webhook takes what real senders send
domain: plugin
status: built
priority: high
created: 2026-10-22
revalidated: 2026-10-22
requires:
  - plans/plugin/48-a-webhook-starts-a-bot-or-an-automation/plan.md
  - plans/plugin/53-a-client-sees-plugins-and-connectors/plan.md
changes: []
creates: []
refs:
  - "[code://packages/webhook/src/route.ts#L53-L78](../../../../packages/webhook/src/route.ts#L53-L78) - the route: `POST` only, and a bearer header is the only proof"
  - "[code://packages/webhook/src/automation.ts#L17-L53](../../../../packages/webhook/src/automation.ts#L17-L53) - the trigger type, and the automation target that takes only a JSON object"
  - "[code://packages/webhook/src/adapter.ts#L27-L126](../../../../packages/webhook/src/adapter.ts#L27-L126) - the adapter's schema: one field set shared by the bot and the automation"
  - "[code://packages/webhook/src/record.ts#L43-L101](../../../../packages/webhook/src/record.ts#L43-L101) - `checkEndpoint`, with `reply` defaulting to `callback`"
  - "[code://packages/webhook/src/bot.ts#L105-L112](../../../../packages/webhook/src/bot.ts#L105-L112) - the callback check that refuses every call to an endpoint with no prefix"
  - "[code://packages/sdk/src/automations/automations.ts#L264-L276](../../../../packages/sdk/src/automations/automations.ts#L264-L276) - `checkTriggers`, which checks only the host's own trigger types"
  - "[code://packages/sdk/src/host/automations.ts#L122](../../../../packages/sdk/src/host/automations.ts#L122) - `configMatches`, where an empty config matches every fire"
  - "[code://packages/sdk/src/host/automations.ts#L1174-L1196](../../../../packages/sdk/src/host/automations.ts#L1174-L1196) - `fired`, which compares no owner of the connector"
  - "[code://packages/sdk/src/types/plugin.ts#L1024](../../../../packages/sdk/src/types/plugin.ts#L1024) - `fireTrigger`, the one way a plugin starts an automation today"
  - "[code://packages/sdk/src/connectors/channel.ts](../../../../packages/sdk/src/connectors/channel.ts) - the connectors channel, where a put is checked"
  - "[code://docs/plugins/WEBHOOKS.md](../../../../docs/plugins/WEBHOOKS.md) - the endpoint, the call and the answers"
  - "[code://packages/webhook/README.md#L35-L51](../../../../packages/webhook/README.md#L35-L51) - the old `webhooks/ci.md` format, which the code no longer reads"
  - https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries - GitHub's `X-Hub-Signature-256`
  - https://docs.stripe.com/webhooks#verify-manually - Stripe's `Stripe-Signature`, with a timestamp
  - https://api.slack.com/authentication/verifying-requests-from-slack - Slack's `X-Slack-Signature` and its `url_verification` challenge
  - https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md - Standard Webhooks, which Svix, OpenAI and Anthropic send
  - https://developers.facebook.com/docs/graph-api/webhooks/getting-started - Meta's `hub.challenge` handshake
  - https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks - Microsoft Graph's `validationToken` and `clientState`
---

## Goal

A webhook connector accepts the calls that real senders make.
GitHub, Stripe, Slack, GitLab, Shopify, Meta, Microsoft Graph and Standard Webhooks senders each prove themselves their own way.
Some senders can set only a URL, and some send forms or text.
A connector can name the automation it starts, and a filter on the connector selects the calls that start it.
Owners are compared, so one person's automation never reads another person's calls.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.
The review in `/github/ahp-review/ahpd-review/ahpd-webhook-review-2026-10-22/README.md` found the defects against `124ef05d`.

### Searches performed

- `rg -n "bearerOf|authorization" packages/webhook/src` - the bearer header is the only proof a call can give.
- `rg -n "JSON.parse" packages/webhook/src/automation.ts` - an automation call takes only a JSON object.
- `rg -n "EVENT_TRIGGERS.find" packages/sdk/src/automations` - a plugin trigger's config is never checked on save.
- `rg -n "fireTrigger" packages/sdk/src/types packages/webhook/src` - a fire carries no owner, and no call starts one automation by its id.

### Runtime path

```
POST /plugins/webhook/<id> -> route: find the open connector -> read the body, at most the limit
  -> the connector's auth scheme: handshake answered, or proof checked -> event data { connector, method, headers, query, body }
  -> connector match -> bot | the named automation | the webhook trigger -> owner rule -> run
```

### Gaps

- No proof other than `Authorization: Bearer`, and no handshake.
- Only a JSON object fires; a form, a text body and an empty body answer 400.
- A run reads the body only, so it cannot tell a GitHub `push` from a `pull_request`.
- A plugin trigger's config and events are not checked on save, and an empty config runs on every fire.
- A fire compares no owner.
- A bot connector with only `bot` and `secret` refuses every call.
- The README shows a format the code no longer reads.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Rewrite the webhook for the senders that exist, not for a caller only we know | Softov, 2026-10-22, "we need to accept real case scenarios, not a sender who only us know" | all |
| A webhook connector may hold an optional `automation: <id>`, and a call starts that automation | Softov, 2026-10-22, "What about the connector with a automation id as optional?" | 02, 03 |
| A connector with no `bot` and no `automation` fires the `webhook` trigger, and each automation whose trigger names the connector runs | Softov, 2026-10-22, chose "Fires the trigger" | 03 |
| The trigger's connector field is checked when the automation is saved | Softov, 2026-10-22, chose "Fires the trigger", whose text says the field is checked on save | 01, 02 |
| Each connector picks one auth scheme: the named sender schemes, a generic HMAC, a token in a header, or a token in the URL | Softov, 2026-10-22, chose all four | 04 |
| A call fires with any body: JSON of any shape, form fields, text, or none | Softov, 2026-10-22, chose "Any body" | 03 |
| A scheme whose sender checks the URL first answers that handshake, and nothing fires | Softov, 2026-10-22, chose "Yes, per scheme" | 05 |
| The bot side keeps `callback`, `sync` and `none`; the default becomes `none`, and `callback` with no `callbackPrefix` is refused on put | Softov, 2026-10-22, chose "All replies, default none" | 06 |
| A run reads `event.body`, `event.headers` and `event.query`, without the auth headers and the URL token; `{{event.<field>}}` of plan 48 breaks | Softov, 2026-10-22, chose "Body, headers, query" | 03 |
| The filter is a `match` on the connector, and it applies to every target of the connector | Softov, 2026-10-22, chose "On the connector" | 03 |
| A connector links to an automation only when both have the same owner or the connector is the host's; checked on save and again at a fire | Softov, 2026-10-22, chose "Same owner or host" | 02 |
| The schemes are `bearer`, `header`, `query`, `hmac`, `github`, `stripe`, `slack`, `standard`, `meta` and `graph`, in the field `auth`; the default is `bearer` | (defaulted: one name for each sender's own method, and today's method stays the default) | 04, 05 |
| GitLab is `header` with `X-Gitlab-Token`, and Shopify is `hmac` with `X-Shopify-Hmac-Sha256`, base64 | (defaulted: those senders send a method a generic scheme already covers) | 04 |
| `meta` and `graph` are named schemes, because their handshakes need them | (defaulted: the handshake answer named Meta and Microsoft Graph) | 05 |
| `meta` keeps a second secret, `verifyToken`, for its handshake; `secret` is the app secret its signature uses | (defaulted: Meta sets the two values apart) | 05 |
| A token in the URL is the query parameter `token` | (defaulted: one name, left out of `event.query`) | 04 |
| A timestamped scheme refuses a call older or newer than 300 seconds | (defaulted: the tolerance Stripe and Slack document) | 04 |
| A body larger than the plugin option `maxBodyBytes`, default 5 MiB, answers 413 | (defaulted: a signature needs the whole body, so a limit bounds it) | 03 |
| `match` maps a dotted path in the event data to a value or a list of values; a path the call lacks blocks the call | (defaulted: "only production" must mean only production, review finding 7) | 03 |
| A call that `match` blocks answers 202 with `{ skipped: true }` | (defaulted: a sender retries a non-2xx answer) | 03 |
| The trigger's field is `connector`, not `endpoint` | (defaulted: the glossary word for a configured record) | 01, 03 |
| A schema field that names a connector carries `x-ahpd-connector` with its adapter, and one that names an automation carries `x-ahpd-automation`; the host checks both on save | (defaulted: one way for the host to check a reference, which a client can also draw as a list) | 02 |
| A plugin starts one automation through a new `PluginHost.runAutomation(id, data, owner)` | (defaulted: `fireTrigger` reaches every automation of a type) | 02, 03 |
| `fireTrigger` takes the connector's owner beside the data, so no body field sets it | (defaulted: review finding 4) | 02, 03 |
| A plugin trigger whose config fails its type's schema does not fire, so a save from before this plan is not a catch-all | (defaulted: review finding 3) | 01 |
| The connector's `oneOf` alternatives carry their own fields, so a bot field on an automation connector is refused | (defaulted: review finding 6) | 06 |
| The stored `automation: true` and the trigger field `endpoint` are a break, said in the changelog, with no migration | (defaulted: the daemon is 0.x, and one connector exists) | 03, 07 |

## Proposed architecture

- **Data flow** - the route reads the raw body up to the limit, then the scheme checks the proof against those bytes. The body is parsed by its content type into `event.body`.
- **Event flow** - a bot connector sends a turn. An `automation` connector calls `runAutomation`. Any other connector calls `fireTrigger` with the connector's owner.
- **State flow** - nothing new is stored; the connector record gains fields, and the vault keeps `secret` and `verifyToken`.
- **Layer responsibilities** - sdk: the trigger checks, the schema references, the owner rule and `runAutomation`.
  webhook: the schemes, the handshakes, the bodies, `match` and the targets.
  docs: the page, the README and the changelog.
- **Source-of-truth files** - [`code://packages/webhook/src/adapter.ts`](../../../../packages/webhook/src/adapter.ts), [`code://packages/sdk/src/automations/automations.ts`](../../../../packages/sdk/src/automations/automations.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A plugin trigger is checked on save and at a fire](task-01-plugin-trigger-checked-on-save-and-fire.md) | done | - |
| [02 - References and owners are checked, and a plugin runs one automation](task-02-references-owners-and-run-automation.md) | done | 01 |
| [03 - A webhook reads any body and starts its target](task-03-a-webhook-reads-any-body.md) | done | 02 |
| [04 - A webhook checks each sender's proof](task-04-a-webhook-checks-each-senders-proof.md) | done | 03 |
| [05 - A webhook answers the senders' handshakes](task-05-a-webhook-answers-handshakes.md) | done | 04 |
| [06 - A bot connector works with its defaults](task-06-a-bot-connector-works-by-default.md) | done | 03 |
| [07 - The docs say what a webhook takes](task-07-the-docs-say-what-a-webhook-takes.md) | done | 04, 05, 06 |

## Risks and tradeoffs

- A signature needs the raw body, so the route reads the body before it checks the proof.
  The limit bounds what a caller without proof can send.
- A token in the URL can land in a proxy log, and the docs say so.
  The `query` scheme is for senders that allow nothing else.
- `{{event.<field>}}` in a saved automation stops filling - the changelog says to write `{{event.body.<field>}}`.

## Resume state

- **Done so far:** tasks 01 to 07 implemented, awaiting review.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** plan 48's answers on the link direction, the default reply and the body shape are replaced by this plan's rows.
  The stored `hook-test` connector needs rewriting by hand after the merge.

## Final verification checklist

- [ ] A GitHub delivery with `X-Hub-Signature-256` starts the automation its connector names, and one with a wrong signature answers 401.
- [ ] A Slack `url_verification` call is answered with its challenge, and nothing fires.
- [ ] A form-encoded call fires, and the run reads `{{event.body.<field>}}`.
- [ ] A connector whose `match` is `headers.x-github-event: push` skips a `pull_request` delivery.
- [ ] An automation of `user:bob` that names a connector of `user:alice` is refused on save.
- [ ] A bot connector with only `bot` and `secret` answers 202.
