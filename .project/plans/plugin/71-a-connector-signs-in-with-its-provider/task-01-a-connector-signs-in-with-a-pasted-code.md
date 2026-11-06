---
title: A connector signs in with a pasted code
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/types/connectors.ts#L226-L253](../../../../packages/sdk/src/types/connectors.ts#L226-L253) - `Adapter`, which gets `signIn`"
  - "[code://packages/sdk/src/connectors/channel.ts#L491-L520](../../../../packages/sdk/src/connectors/channel.ts#L491-L520) - the put handler, which a finished sign-in reuses"
  - "[code://packages/sdk/src/connectors/channel.ts#L649](../../../../packages/sdk/src/connectors/channel.ts#L649) - the command table"
  - "[code://packages/sdk/src/connectors/adapters.ts#L56-L69](../../../../packages/sdk/src/connectors/adapters.ts#L56-L69) - `rowOf`, which carries `signIn` to a client"
---

## Objective

An adapter declares a sign-in, and the connectors channel starts and finishes it.
A finished sign-in makes or changes the connector as a put does, with the key in the vault.

## Files

- `UPDATE: packages/sdk/src/types/connectors.ts:226-253` - add `SignIn` and the optional `Adapter.signIn`.
- `UPDATE: packages/sdk/src/connectors/channel.ts` - add `x-ahpd/connectors/signin` and `x-ahpd/connectors/signin-finish`, and move the put body into a function both use.
- `UPDATE: packages/sdk/src/connectors/adapters.ts:56-69` - send `signIn: { title, field }` on the adapter row.
- `CREATE: packages/sdk/test/connectors-signin.test.ts` - the flow against a fake adapter.
- `UPDATE: docs/plugins/PLUGINS.md` - the adapter's `signIn` and the two commands.

## Steps

1. Add `SignIn` to `types/connectors.ts` with `title`, `field`, `url(challenge, state)` and `exchange(code, verifier)`.
2. Refuse at registration a `signIn.field` that the schema does not mark `writeOnly`.
3. Move the body of the put handler into one function that takes the params and the caller.
4. Add `signin`: run the put's owner checks, and refuse an adapter with no `signIn`.
5. Make a verifier of 32 random bytes.
6. Make the S256 challenge and a state of 32 random bytes, both base64url.
7. Keep `{ verifier, params, caller, expires }` under the state for 10 minutes, at most 10 for each caller.
8. Answer `{ url, state }`, with the URL from `signIn.url(challenge, state)`.
9. Add `signin-finish`: take `{ state, code }`, refuse an unknown, expired or other caller's state, and delete the state.
10. Run the put's owner checks again, then call `exchange(code, verifier)` with a 10 second limit.
11. Run the put function with the key in `config[field]`, and answer the connector row.
12. Answer a failed exchange with the adapter's title and the vendor's status only.
13. Send `signIn: { title, field }` in `rowOf` when the adapter has one.
14. Write the docs for `signIn` and the two commands in `PLUGINS.md`.

## Validation

- `connectors-signin.test.ts` covers a full sign-in: the vault holds the key, and the record holds a `$secret` reference.
- It covers a refused state: unknown, expired, used, or another caller's.
- It covers an adapter with no `signIn`.
- It covers a caller who lost `connector:put` between start and finish, and an 11th start that drops the first.
- It checks that no error and no log line carries the code, the verifier or the key.
- `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test` passes.

## Resume
