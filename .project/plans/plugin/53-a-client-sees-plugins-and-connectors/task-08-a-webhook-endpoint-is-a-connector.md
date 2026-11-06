---
title: A webhook endpoint is a connector
status: done
depends: [task-07-a-client-makes-connectors.md]
layer: "webhook"
refs:
  - "[code://packages/webhook/src/plugin.ts#L217-L226](../../../../packages/webhook/src/plugin.ts#L217-L226) - the `webhooks` records and the route"
  - "[code://packages/webhook/src/record.ts#L16-L31](../../../../packages/webhook/src/record.ts#L16-L31) - `Endpoint` and `checkEndpoint`"
  - "[code://packages/webhook/src/route.ts](../../../../packages/webhook/src/route.ts) - `webhookRoute`, which finds an endpoint by id"
---

## Objective

The webhook plugin registers the connector kind `webhook`.
A person makes an endpoint from a client, and its URL is `/plugins/webhook/<id>`.
The plugin no longer reads the `webhooks` collection.

## Files

- `CREATE: packages/webhook/src/kind.ts` - the `webhook` kind, its schema and its `receive` capability.
- `UPDATE: packages/webhook/src/plugin.ts:217-226` - register the kind, and give the route the open connectors.
- `UPDATE: packages/webhook/src/record.ts:16-31` - make `secret` the secret value, not a vault name.
- `UPDATE: packages/webhook/package.json` - add `webhook` to `ahpd.contracts.connectors`.
- `UPDATE: packages/webhook/test/webhook-route.test.ts` - endpoints come from connectors.
- `CREATE: packages/webhook/test/webhook-kind.test.ts` - the cases below.

## Steps

1. Write the schema from the `Endpoint` fields, with `secret` as a `writeOnly` string.
2. Make `bot` and `automation` a `oneOf`, so a client draws a choice.
3. Declare one `receive` capability, titled "Receives calls".
4. In `open`, check the config with `checkEndpoint`, and keep the endpoint in a map by id.
5. In the answered `close`, remove it from the map.
6. Give the route `endpoint: (id) => map.get(id)`, and compare the secret it holds.
7. Remove `host.records('webhooks')`.
8. Keep `webhook-threads` keyed by the endpoint id.
9. Run the webhook tests, and set this task and the plan row to `implemented`.

## Validation

- `webhook-kind.test.ts`: two connectors answer their own URLs, and a removed one answers 404.
- `webhook-kind.test.ts`: the route refuses a call with the wrong bearer.
- `webhook-kind.test.ts`: a `webhooks/<id>.md` file on disk makes no endpoint.
- `pnpm -s exec vitest run packages/webhook` passes.

## Resume

- **Done so far:** `packages/webhook/src/kind.ts` is the `webhook` kind: the schema, one `receive` capability titled "Receives calls", and `open`.
  `open` checks the config with `checkEndpoint`, keeps the endpoint in a map by id, and answers a close that takes it out again.
  `plugin.ts` registers the kind, gives the route `endpoints.get(id)`, and no longer opens `webhooks`; `webhook-threads` is still keyed by the endpoint id.
  `record.ts` makes `secret` the value a caller sends; `route.ts` compares the bearer to it and answers 404 for an id no open connector answers for.
  `package.json` declares `connectors: ["webhook"]`.
- **Done so far:** `webhook-route.test.ts` runs over endpoints the connectors made.
  `webhook-kind.test.ts` has five cases.
  They are the `writeOnly` secret and the capability, two connectors at their own URLs with one removed, and a wrong bearer.
  The last two are an old `webhooks` record making no endpoint, and a config naming both targets.
- **Next action:** task 09.
- **Open questions:** none.
- **Departures:**
  - The schema keeps `properties` at the top level and repeats the object in `allOf`.
    The validator stops at the first of `allOf` and `oneOf` it meets.
    The connector channel reads `writeOnly` from `properties`, so a root `oneOf` alone would check no field and hide the secret.
  - `WebhookSeams` loses `secret(name)` and `problem`.
    The endpoint's secret is its value, and a config `checkEndpoint` refuses is refused when the connector opens rather than when a call arrives.
    The route's 404 for a record that is not an endpoint went with the check.
  - `packages/server/test/webhook-bot.test.ts` changed too, though it is not in Files: it opens the kind directly, because that daemon test serves no connector channel.
    Its vault entry is renamed to `host:connector/ci/secret`, the name a put writes.
  - The "a `webhooks/<id>.md` file makes no endpoint" case puts the old record in a memory store instead of a file.
    `fileRecords` is the server package's, and the boundary check keeps the webhook tests off it.
    The case also asserts the plugin opens no collection but `webhook-threads`.
  - The header comment of `webhook-record.test.ts` now says a connector's config, not a hand-written record.
- **Watch out for:** a remade endpoint with the same id keeps its threads. `open` and its close never touch `webhook-threads`, so the rows outlive the connector and are found again by endpoint id.
  A call to a connector the host has not opened yet answers 404, because the route reads only the open map.
