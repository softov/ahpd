---
title: A bot connector works with its defaults
status: done
depends: [task-03-a-webhook-reads-any-body.md]
layer: "webhook"
refs:
  - "[code://packages/webhook/src/record.ts#L71](../../../../packages/webhook/src/record.ts#L71) - `reply` defaults to `callback`"
  - "[code://packages/webhook/src/bot.ts#L105-L112](../../../../packages/webhook/src/bot.ts#L105-L112) - the check that refuses every call to an endpoint with no prefix"
  - "[code://packages/webhook/src/adapter.ts#L27-L126](../../../../packages/webhook/src/adapter.ts#L27-L126) - `FIELDS`, one field set for both alternatives"
---

## Objective

A bot connector made with only `bot` and `secret` answers its calls.
A connector that cannot work is refused when it is saved, not when it is called.

## Files

- `UPDATE: packages/webhook/src/record.ts:43-101` - the default `reply`, and the refusals below.
- `UPDATE: packages/webhook/src/adapter.ts:27-126` - the bot fields in the bot alternative only.
- `UPDATE: packages/webhook/test/webhook-kind.test.ts` - the cases below.

## Steps

1. Make `none` the default `reply`.
2. Refuse a put whose `reply` is `callback` with no `callbackPrefix`.
3. Move `reply`, `callbackPrefix` and `syncTimeoutSeconds` into the bot alternative of the `oneOf`.
4. Keep `secret`, `verifyToken` and every auth field in the top-level `properties`, where the host reads `writeOnly`.
5. Refuse a bot field on a connector with no `bot` in `checkEndpoint`.
6. Stop storing a `reply` on a connector with no `bot`.
7. Run the webhook tests, and set this task and the plan row to `implemented`.

## Validation

- `webhook-kind.test.ts`: a connector with only `bot` and `secret` answers a call with 202.
- `webhook-kind.test.ts`: the host answers `-32602` to a put with `reply: callback` and no `callbackPrefix`.
- `webhook-kind.test.ts`: the host refuses a put with `automation` and `reply`.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** all steps. `checkEndpoint` defaults `reply` to `none`, refuses `reply: callback` with no `callbackPrefix`, refuses `reply`, `callbackPrefix` or `syncTimeoutSeconds` on a connector with no `bot`, and stores no `reply` on a connector with no `bot` - `Endpoint.reply` is optional now. The adapter's schema keeps every field in the top-level `properties`, where the host reads `writeOnly` (`secret`, `verifyToken`) and `x-ahpd-automation` (`automation`), and moves the field rules into three `oneOf` alternatives: `CALLBACK` (a bot, the `callback` reply and its prefix, both required), `BOT` (a bot with `reply` limited to `sync` and `none`, defaulting to `none`) and `PLAIN` (an automation or the trigger, with no bot field at all). `webhook-kind.test.ts` covers the three cases, and its local checker now follows `oneOf` and `enum` so the put path through `connectorsChannel` is what answers `-32602`.
- **Next action:** task-07-the-docs-say-what-a-webhook-takes.md.
- **Open questions:** none.
- **Departures:** step 2 cannot be said in one alternative, because the checker has no `if/then`; the bot side is two alternatives, one where the callback reply requires its prefix and one that cannot name `callback`, so a put with `reply: callback` and no prefix matches none of the three and the host answers `-32602` rather than opening the connector and failing with `-32603`. The test's checker is the local subset the other adapter tests use, not the daemon's cofold validator; the schema is held to the same keywords (`oneOf`, `enum`, `required`, `additionalProperties`, `default`). No commit was made, and the test run rewrote `packages/sdk/test/fixtures/wire.jsonl`; `git checkout --` is denied in this session, so the file is left dirty.
- **Watch out for:** the top-level `properties` still lists every field so the host can read `writeOnly` and `x-ahpd-automation`; the alternatives are what refuse a field. `botTarget` compares `endpoint.reply` against `callback` and `sync`, so an absent reply answers like `none`, which is what a hand-written record without the field gets.
