---
title: The docs say what a webhook takes
status: done
depends: [task-04-a-webhook-checks-each-senders-proof.md, task-05-a-webhook-answers-handshakes.md, task-06-a-bot-connector-works-by-default.md]
layer: "docs"
refs:
  - "[code://docs/plugins/WEBHOOKS.md](../../../../docs/plugins/WEBHOOKS.md) - the endpoint, the call and the answers"
  - "[code://packages/webhook/README.md#L35-L51](../../../../packages/webhook/README.md#L35-L51) - the old `webhooks/ci.md` format"
  - "[code://docs/sdk/AUTOMATIONS.md](../../../../docs/sdk/AUTOMATIONS.md) - what a plugin trigger is, and when a save is refused"
  - "[code://docs/plugins/PLUGINS.md](../../../../docs/plugins/PLUGINS.md) - `fireTrigger`, and the place for `runAutomation` and the schema references"
  - "[code://CHANGELOG.md](../../../../CHANGELOG.md) - the unreleased section"
---

## Objective

A person sets up a webhook for a real sender from the docs alone.
The README and the docs page agree.

## Files

- `UPDATE: docs/plugins/WEBHOOKS.md` - the targets, each scheme, the handshakes, the bodies, `match` and the event data.
- `UPDATE: packages/webhook/README.md` - one connector example in the current format, and a link to WEBHOOKS.md.
- `UPDATE: docs/sdk/AUTOMATIONS.md` - a plugin trigger is checked on save, and a reference must pass the owner rule.
- `UPDATE: docs/plugins/PLUGINS.md` - `runAutomation`, the `owner` of `fireTrigger`, `x-ahpd-connector` and `x-ahpd-automation`.
- `UPDATE: CHANGELOG.md` - the new schemes and bodies, and the breaks.

## Steps

1. Write one connector example for each sender in WEBHOOKS.md: GitHub, Stripe, Slack, GitLab, Shopify, Standard Webhooks, Meta and Microsoft Graph.
2. Write the event data a run reads, with one GitHub example.
3. Write `match`, with the GitHub `push` example.
4. Write the three targets and the owner rule.
5. Say that a token in the URL can be in a proxy log.
6. Replace the README's endpoint section with one current example.
7. Add the save check and the owner rule to AUTOMATIONS.md.
8. Add `runAutomation`, the `owner` argument and the two schema keys to PLUGINS.md.
9. List the breaks in the changelog: `automation: true`, the trigger field `endpoint`, `{{event.<field>}}` and the default `reply`.
10. Run `pnpm -s docs:build`, and set this task and the plan row to `implemented`.

## Validation

- `rg -n "webhooks/ci.md|secret: host:" packages/webhook/README.md docs` finds nothing.
- WEBHOOKS.md has one example for each of the eight senders.
- The changelog names each break of plan 54.
- `pnpm -s docs:build` passes.

## Resume

- **Done so far:** all steps. WEBHOOKS.md is rewritten around the connector: the field table, the `oneOf` refusals, the call and its answers, the ten schemes, the three handshakes, one connector for each of the eight senders, the bodies, the event data with a GitHub run, `match` with the GitHub `push`, the three targets and the owner rule, the bot target, the trigger with a `connector` config, the public port and the grants. The README's endpoint section is one current connector in the `x-ahpd/connectors/put` format, and its options table gains `maxBodyBytes`. AUTOMATIONS.md says a plugin trigger is checked on save, that an `x-ahpd-connector` field names a connector of its adapter, and that the owner rule is checked on both saves and again at a fire. PLUGINS.md documents `runAutomation`, the `owner` argument of `fireTrigger`, the two schema marks and the `oneOf` form. The changelog's unreleased section has four upgrading bullets for the breaks and a Webhooks section for the new behaviour.
- **Next action:** none. The plan awaits review, and its final verification checklist is the next reader's.
- **Open questions:** none.
- **Departures:** the plan's `plans/index.md` row and Resume state were updated to say the seven tasks are implemented, which no step asked for, because the row still said all seven were todo. The changelog's Webhooks section also names `PluginHost.runAutomation` and the schema marks, which are sdk changes rather than webhook docs. No commit was made, and `packages/sdk/test/fixtures/wire.jsonl` was rewritten by the earlier test runs.
- **Watch out for:** WEBHOOKS.md is not hard-wrapped; keep one paragraph on one line. PLUGINS.md is wrapped around the adapter section and unwrapped around the trigger section, and each addition follows the paragraph it extends.
