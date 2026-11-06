---
title: A webhook answers the senders' handshakes
status: done
depends: [task-04-a-webhook-checks-each-senders-proof.md]
layer: "webhook"
refs:
  - "[code://packages/webhook/src/route.ts#L58](../../../../packages/webhook/src/route.ts#L58) - the route answers every method but `POST` with 405"
  - https://api.slack.com/events/url_verification - Slack's `url_verification` call and its `challenge`
  - https://developers.facebook.com/docs/graph-api/webhooks/getting-started - Meta's `GET` with `hub.mode`, `hub.verify_token` and `hub.challenge`, and `X-Hub-Signature-256` on each event
  - https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks - Microsoft Graph's `validationToken`, and `clientState` on each notification
---

## Objective

A connector whose sender checks the URL first answers that check, and nothing fires.
Meta and Microsoft Graph become named schemes, because their handshakes need them.

## Files

- `UPDATE: packages/webhook/src/auth.ts` - the `meta` and `graph` schemes, and a handshake for `slack`, `meta` and `graph`.
- `UPDATE: packages/webhook/src/route.ts` - answer a handshake before the target, and take `GET` for `meta`.
- `UPDATE: packages/webhook/src/adapter.ts` - the values `meta` and `graph`, and the `writeOnly` field `verifyToken`.
- `UPDATE: packages/webhook/src/record.ts` - the same in `checkEndpoint`.
- `CREATE: packages/webhook/test/handshake.test.ts` - the cases below.

## Steps

1. Answer a `slack` call whose body has `type: url_verification` with its `challenge`, after its signature passes.
2. Take `GET` on a `meta` connector, and answer `hub.challenge` when `hub.verify_token` equals `verifyToken`.
3. Answer 403 to a `meta` `GET` with a wrong `hub.verify_token`.
4. Check `X-Hub-Signature-256` with `secret` on a `meta` `POST`.
5. Answer a `graph` call that has the query `validationToken` with that token, as `text/plain`.
6. Check that every `clientState` in a `graph` notification equals `secret`.
7. Require `verifyToken` for `meta` in the schema.
8. Answer `GET` with 405 on every other scheme, as today.
9. Run the webhook tests, and set this task and the plan row to `implemented`.

## Validation

- `handshake.test.ts`: a signed Slack `url_verification` call answers 200 with its challenge, and nothing fires.
- `handshake.test.ts`: a Meta `GET` with the right token answers its challenge, and a wrong token answers 403.
- `handshake.test.ts`: a Graph call with `validationToken` answers it as `text/plain` within the call.
- `handshake.test.ts`: a Graph notification with a wrong `clientState` answers 401.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** all steps. `AUTH_SCHEMES` gains `meta` and `graph`. `auth.ts` exports `validation(endpoint, call)` - Meta's `GET` with `hub.mode=subscribe`, `hub.verify_token` and `hub.challenge` (403 on a wrong token), and Graph's `validationToken` answered as `text/plain` - and `challenge(endpoint, call)`, Slack's `url_verification` answer, called only after the signature passes. A Meta `POST` is checked by `X-Hub-Signature-256` over the raw body; a Graph notification is accepted when every `value[].clientState` equals the secret. `Endpoint` carries `verifyToken`, the adapter schema marks it `writeOnly`, and `checkEndpoint` requires it for `meta`. The route takes `GET` only on a `meta` connector and answers 405 everywhere else. `handshake.test.ts` covers all six cases.
- **Next action:** task-06-a-bot-connector-works-by-default.md.
- **Open questions:** none.
- **Departures:** requiring `verifyToken` for `meta` is enforced in `checkEndpoint` rather than in the schema, for the same reason as task 04 (no `if/then` in the daemon's checker). The Meta handshake also requires `hub.mode=subscribe`, which the docs send; a `GET` with any other mode answers 403. A Graph notification with an empty or missing `value` list is refused. The route's 405 sentence still says "A webhook takes POST only", although Meta takes a GET; the status is what tests read. No commit was made.
- **Watch out for:** Graph's `validationToken` is answered before `proves`, since Graph sends no proof on that call, and before `match`, since it is not a notification. Slack's answer is after `proves`. The Slack and Standard timestamp headers are still in the call's headers, because their checks read them.
