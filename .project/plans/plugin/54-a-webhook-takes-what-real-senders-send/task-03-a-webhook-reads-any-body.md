---
title: A webhook reads any body and starts its target
status: done
depends: [task-02-references-owners-and-run-automation.md]
layer: "webhook"
refs:
  - "[code://packages/webhook/src/route.ts#L53-L78](../../../../packages/webhook/src/route.ts#L53-L78) - the route, which reads the body in each target"
  - "[code://packages/webhook/src/automation.ts#L17-L53](../../../../packages/webhook/src/automation.ts#L17-L53) - the trigger type and the automation target"
  - "[code://packages/webhook/src/adapter.ts#L27-L126](../../../../packages/webhook/src/adapter.ts#L27-L126) - the adapter's schema"
  - "[code://packages/webhook/src/record.ts#L43-L101](../../../../packages/webhook/src/record.ts#L43-L101) - `checkEndpoint`"
  - "[code://packages/webhook/src/plugin.ts#L217-L227](../../../../packages/webhook/src/plugin.ts#L217-L227) - where the plugin registers the trigger, the adapter and the route"
---

## Objective

A call with any body fires, and a run reads the call's body, headers and query.
A connector's `match` selects the calls that reach its target.
A connector talks to its `bot`, starts its `automation`, or fires the `webhook` trigger.

## Files

- `CREATE: packages/webhook/src/call.ts` - the call as event data: the body read up to the limit, parsed by its type.
- `UPDATE: packages/webhook/src/route.ts:53-78` - read the call once, apply `match`, and choose the target.
- `UPDATE: packages/webhook/src/automation.ts:17-53` - the trigger field `connector`, and the two automation targets.
- `UPDATE: packages/webhook/src/adapter.ts` - `automation` as an id with `x-ahpd-automation`, and `match`.
- `UPDATE: packages/webhook/src/record.ts:43-101` - the same fields in `checkEndpoint`.
- `UPDATE: packages/webhook/src/plugin.ts` - the option `maxBodyBytes`, and `runAutomation` in the seams.
- `CREATE: packages/webhook/test/call.test.ts` - the cases below.

## Steps

1. Read the raw body up to `maxBodyBytes`, default 5 MiB, and answer 413 over it.
2. Parse a JSON content type, or a body that parses as JSON, into `event.body`.
3. Parse `application/x-www-form-urlencoded` into an object of fields.
4. Keep any other body as text, and an empty body as `null`.
5. Lowercase the header names into `event.headers`, without `authorization`, `cookie` and the scheme's token header.
6. Put the query into `event.query`, without the `token` parameter.
7. Add `connector`, the connector id, and `method` to the event data.
8. Add `match` to the schema: an object of dotted paths, each to a string or a list of strings.
9. Answer 202 with `{ skipped: true }` when a path is missing or its value is not listed.
10. Make `automation` an optional automation id with `x-ahpd-automation`, in place of `true`.
11. Call `runAutomation` with the event data and the connector's owner when the connector has `automation`.
12. Call `fireTrigger` with the event data and the connector's owner when the connector has neither `bot` nor `automation`.
13. Rename the trigger field `endpoint` to `connector`, mark it `x-ahpd-connector`, and keep it required.
14. Run the webhook tests, and set this task and the plan row to `implemented`.

## Validation

- `call.test.ts`: a form-encoded body fires, and `event.body` holds its fields.
- `call.test.ts`: a text body, an empty body and a JSON array each fire.
- `call.test.ts`: `event.headers` holds `x-github-event` and no `authorization`.
- `call.test.ts`: a body over the limit answers 413, and nothing fires.
- `call.test.ts`: `match` `headers.x-github-event: push` skips a `pull_request` delivery and a call with no such header.
- `call.test.ts`: a connector with `automation` runs that automation and fires no trigger.
- `call.test.ts`: a connector with neither target fires the trigger with the connector's owner.
- A stored connector with `automation: true` reads as `invalid`.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** all steps. `call.ts` reads a call once: the body up to `maxBodyBytes` (default 5 MiB, 413 over it, cut off mid-stream), parsed by its content type (JSON, form, text, `null` when empty), with headers lowercased minus `authorization`, `cookie` and the proof's own header, and the query minus `token`; `dataOf` adds `connector` and `method`. `allows` applies the connector's `match` to that data, refusing a missing path and answering `202 { skipped: true }`; `at` walks the dotted path. The route picks `bot`, then `automation`, then the trigger, each seam carrying the connector's owner from `adapter.open`. `automation` is now an id marked `x-ahpd-automation`, `match` is in the adapter schema, and `endpoints`/`Endpoint` carry `match` and `owner`. `checkEndpoint` refuses both targets and validates `match`; a connector with neither is allowed. The trigger field is `connector`, required, marked `x-ahpd-connector`. The plugin option `maxBodyBytes` is registered and passed to the route. `call.test.ts` covers the seven cases, and `webhook-kind.test.ts` reads a stored `automation: true` as `invalid`.
- **Next action:** task-04-a-webhook-checks-each-senders-proof.md.
- **Open questions:** none.
- **Departures:** `webhook-automation.test.ts` keeps only the trigger-type definition, because `automationTarget` was removed; the trigger, automation and owner cases moved to `call.test.ts` and `webhook-route.test.ts`. The stored-connector `invalid` case uses a small schema check mirroring the subset the daemon's checker reads, because the real checker belongs to the server package. The adapter schema does not yet use `oneOf`/`allOf`: the checker the server uses supports neither `not` nor `allOf`, so "both targets" is refused in `checkEndpoint` and the bot-only fields move into a `oneOf` branch in task 06. No commit was made: `git add`/`git commit` and `git checkout` of `wire.jsonl` are denied in this session, so the files stay uncommitted.
- **Watch out for:** the proof header is not known to `readCall` yet, so task 04 passes it as `omit`, and a signature is checked over `call.raw`. The bot target now reads `Call`, not `Request`.
