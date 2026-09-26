---
title: Models, sign-in and the inner host's requests cross the proxy
status: todo
depends: [task-12-the-proxy-answers-only-what-it-knows.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/nested.ts#L411](../../../../packages/sdk/src/nested.ts#L411) - `models`, always empty"
  - "[code://packages/sdk/src/nested.ts#L506](../../../../packages/sdk/src/nested.ts#L506) - `awaiting`, always empty"
  - "[code://packages/sdk/src/nested.ts#L299](../../../../packages/sdk/src/nested.ts#L299) - every event that is not an action is skipped, `auth/required` included"
  - "[code://packages/sdk/src/nested.ts#L369-L371](../../../../packages/sdk/src/nested.ts#L369-L371) - the `AhpClient`, with no server request handler"
---

## Objective

The session's models are the inner host's for this provider, an inner `auth/required` becomes the outer session's `awaiting()` and `authenticated()` signs the inner session in, and a request the inner host makes of the proxy is answered with a sentence rather than `MethodNotFound`.

## Files

- `UPDATE: packages/sdk/src/nested.ts:369-393` - `bringUp`: the root subscription, the request handler.
- `UPDATE: packages/sdk/src/nested.ts:295-332` - `pump`: `authRequired` events.
- `UPDATE: packages/sdk/src/nested.ts:411` and `:506` - `models`, `awaiting`, and a new `authenticated`.

## Steps

1. Subscribe to `ahp-root://` on the inner host and answer `models()` from its `agents` entry for this provider, kept current from its actions.
2. Keep the resources an inner `auth/required` names for the inner session, and answer `awaiting()` from them.
3. Implement `authenticated(resource, token)` as the inner `authenticate` request, answering whether the inner host took it.
4. Install `setResourceRequestHandlers` on the client, each method refusing with a sentence saying the proxy publishes no resources, and log the request.
5. If a member cannot be answered this way, leave it out, per [the decision](../../../decisions/the-nested-proxy-leaves-out-what-it-cannot-forward.md).

## Validation

- `test/nested-proxy.test.ts` with the in-memory inner `createHost`:
  - an inner backend with two models makes `session.models()` answer both; today `[]`;
  - an inner `auth/required` for the session makes `awaiting()` answer its resource, and `authenticated` reaches the inner host; today `[]` and absent;
  - a scripted inner host that sends `resourceRead` gets an error whose message says the proxy publishes no resources; today `no handler for server method`.
- `node_modules/.bin/vitest run test/nested-proxy.test.ts` passes.

## Resume
