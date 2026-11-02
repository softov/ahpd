---
title: A sign-in shows a code and waits
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/types/connectors.ts#L272-L288](../../../../packages/sdk/src/types/connectors.ts#L272-L288) - `SignIn`, which gets a device-code sibling"
  - "[code://packages/sdk/src/connectors/channel.ts#L623-L695](../../../../packages/sdk/src/connectors/channel.ts#L623-L695) - `ownerChecks` and `prepare`, run at the start and again before the put"
  - "[code://packages/sdk/src/connectors/channel.ts#L763-L881](../../../../packages/sdk/src/connectors/channel.ts#L763-L881) - `signin` and `signin-finish`, which branch on the flow"
  - "[code://packages/sdk/src/connectors/adapters.ts#L68](../../../../packages/sdk/src/connectors/adapters.ts#L68) - the row's `signIn`, which gets `flow`"
  - "[code://packages/sdk/src/plugins/validate.ts#L686-L728](../../../../packages/sdk/src/plugins/validate.ts#L686-L728) - `checkSignIn`, which accepts the device shape"
  - "[code://packages/sdk/test/connectors-signin.test.ts](../../../../packages/sdk/test/connectors-signin.test.ts) - the pasted-code tests, which the device tests sit beside"
---

## Objective

An adapter declares a device-code sign-in, and the connectors channel starts it, polls it and finishes it.
The host writes the connector only after the approval, refuses another account unless the adapter allows it, and keeps the id on a second sign-in.

## Files

- `UPDATE: packages/sdk/src/types/connectors.ts:272-288` - add `DeviceSignIn` with `flow: 'device'`, `start()`, `poll(handle)`, `account?` and `switchAccount?`, and make `SignIn` the union of both flows.
- `UPDATE: packages/sdk/src/connectors/channel.ts:763-881` - branch `signin` and `signin-finish` on the flow, poll in the host, and wait in the finish.
- `UPDATE: packages/sdk/src/connectors/adapters.ts:68` - send `flow` on the row's `signIn`.
- `UPDATE: packages/sdk/src/plugins/validate.ts:686-728` - check the device shape at registration.
- `UPDATE: packages/sdk/src/index.ts` - export the new types.
- `UPDATE: packages/sdk/test/connectors-signin.test.ts` - the device flow against a fake adapter and fake timers.
- `UPDATE: docs/plugins/PLUGINS.md:656` - the device-code `signIn` beside the pasted code.
- `UPDATE: docs/plugins/PLUGINS.md:1509-1515` - what `signin` answers and what `signin-finish` takes for each flow.

## Steps

1. Add `DeviceSignIn` with `flow: 'device'`, `title`, `field`, `account?`, `switchAccount?`, `start()` and `poll(handle)`.
2. Make `start()` answer `{ code, url, expires, interval, handle }`, with `expires` and `interval` in seconds.
3. Make `poll(handle)` answer `{ values }`, or `{ wait }` with the next interval in seconds; a refusal throws.
4. Keep a `signIn` with no `flow` as the pasted code, so OpenRouter and claude-login stay unchanged.
5. In `checkSignIn`, require `start` and `poll` for a device flow, and a non-secret schema field for `account`.
6. Send `signIn: { title, field, flow }` on the adapter row, with `flow` `code` or `device`.
7. In `signin` for a device flow, run `prepare` and call `start()`.
8. Keep the handle, the params and the starter's reader under a new state.
9. Set the entry's expiry from `expires`, and keep the limit of 10 started sign-ins for each caller.
10. Answer `{ state, code, url, expires }`, and never the handle.
11. Poll with an unref'd timer at `interval`, and use a `wait` answer as the next interval.
12. Stop the poll at the expiry, at a refusal, and when the host drops the entry.
13. On `values`, run `ownerChecks` again with the starter's reader, then the account rule.
14. Refuse a different `account` when the adapter has no `switchAccount`.
15. Word the refusal "signed in as <new>, this connector is <old>".
16. Run the put with every value in its schema field.
17. Let the put move the secrets to the vault and keep the account in the record.
18. Settle one outcome per entry, the row or the error, and keep it until the expiry for a late `signin-finish`.
19. In `signin-finish` for a device flow, take `{ state }` alone, check the caller as today, and wait for the outcome.
20. Keep the pasted-code `signin-finish` unchanged, and refuse a `code` sent to a device sign-in.
21. Write the device flow in `PLUGINS.md`: the shape, the commands, the account rule and what no log carries.

## Validation

- `packages/sdk/test/connectors-signin.test.ts` holds a device sign-in that answers the code, polls through two `wait` answers, and finishes with the row.
- The same file holds: no record exists before the approval.
- The same file holds: a refusal or the expiry ends the finish with the error.
- The same file holds: the connector reaches the list after its caller leaves.
- The same file holds: another caller may not finish it.
- The same file holds: a second sign-in with the same account keeps the id.
- The same file holds: the host refuses another account, and accepts it with `switchAccount`.
- The same file holds: no answer, row, error or log carries the handle or a secret value.
- `packages/sdk/test/plugin-validate.test.ts` refuses a device flow with no `poll`.
- The same file refuses an `account` field marked secret.
- `pnpm --filter @ahpd/sdk test -- connectors-signin` passes, and the pasted-code tests in it still pass.
- `pnpm typecheck` passes.

## Resume

Built: the `SignIn` union with `DeviceSignIn`, and the adapter row's `flow`. The registration check takes the device shape and the account rule. The host's device start, poll and finish are in `x-ahpd/connectors/signin` and `x-ahpd/connectors/signin-finish`. The suites hold the pasted-code cases, seven device cases in `connectors-signin.test.ts`, and the two registration cases in `plugin-validate.test.ts`. `PLUGINS.md` has the device flow in the `signIn` bullet, the adapter row, the two method rows and the sign-in paragraphs.

Departures:
- The `SignIn` union makes `adapter.signIn` a `CodeSignIn | DeviceSignIn`, so `packages/agent-claude/test/agent-claude-login-adapter.test.ts` and `packages/server/test/openrouter-signin.test.ts` narrow it through a `signInOf` helper. Neither file is in Files, and neither test's subject changed.
- A device finish's wait has its own timer at the code's expiry. An expiry does not cut off a put that is already writing the values. The steps name the expiry and one outcome per entry. This keeps a vendor poll that never returns from leaving the caller without an answer, and from answering `expired` beside a written row.
- `packages/sdk/test/fixtures/wire.jsonl` is rewritten by the runs and could not be restored: `git checkout --` is denied in this mode. It is not committed, and the restore is `git checkout -- packages/sdk/test/fixtures/wire.jsonl` once the file can be restored.

Gates: `pnpm -s build` pass, `pnpm exec tsc -p tsconfig.json --noEmit` pass, `pnpm -s boundary` pass. `packages/sdk/test/connectors-signin.test.ts` 22 pass, `packages/sdk/test/plugin-validate.test.ts` 30 pass.
