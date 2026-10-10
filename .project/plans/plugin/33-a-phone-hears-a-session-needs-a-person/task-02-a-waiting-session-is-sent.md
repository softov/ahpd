---
title: A waiting session is sent to the devices whose client created or opened it
status: done
depends:
  - task-01-a-device-registers-under-push.md
layer: "push"
refs:
  - "[code://packages/sdk/src/types/events.ts#L105-L116](../../../../packages/sdk/src/types/events.ts#L105-L116) - the event this sends on"
  - "[code://packages/sdk/src/types/plugin.ts#L180](../../../../packages/sdk/src/types/plugin.ts#L180) - `secret(name, work?)`"
  - "[code://packages/computer/src/plugin.ts#L57-L61](../../../../packages/computer/src/plugin.ts#L57-L61) - `needValue`, the `secretAtUse` pattern"
  - https://docs.expo.dev/push-notifications/sending-notifications/ - the request, tickets and receipts
---

## Objective

Each new `input_needed_set` id sends one Expo push message to each registered device whose client created or opened that session, and a device Expo no longer knows is removed.

## Files

- `CREATE: packages/push/src/send.ts` - batches of up to 100 messages to `https://exp.host/--/api/v2/push/send`, and the receipts of the tickets the previous send left.
- `UPDATE: packages/push/src/plugin.ts` - subscribes to `input_needed_set` and `input_needed_removed`; options `title` (default the daemon's name) and `accessToken`, declared `{ type: 'string', writeOnly: true, secretAtUse: true }`.
- `CREATE: packages/push/test/send.test.ts` - against a stubbed endpoint.

## Steps

1. Keep the `(session, id)` pairs seen; a repeated pair sends nothing; a removal forgets it and sends nothing, no clearing message.
2. Send only to the devices whose client created or opened the session; a device whose client did neither is sent nothing.
3. A message is `{ to, title, body, data: { uri: <session>, kind } }`; the body is "A session is waiting for your answer" or, for `toolConfirmation`, "A session is waiting for your approval".
4. Read `accessToken` at each send: a `{ "$secret": "<name>" }` through `host.secret(name)`, a plain string as written. A read that throws logs one line naming `accessToken` and sends nothing for that event.
5. A POST that fails or answers an error, and a receipt read that fails, log one line and never throw.
6. Keep the tickets a send answers, and read their receipts at the next send, before its POST; no timer. Devices reported `DeviceNotRegistered` are removed.

## Validation

- `send.test.ts`: one set for a session both devices' clients opened is two messages in one request; a device whose client neither created nor opened the session gets no message; the same `(session, id)` again sends nothing, and the same id from another session sends; a removal sends nothing.
- The same file: a send reads the receipts of the tickets the previous send left, and none before the first send; `DeviceNotRegistered` in those receipts removes the device.
- The same file: with `accessToken` a `$secret` the vault does not hold, the send logs one line and makes no request, and the next event with the secret present sends.
- The same file: an endpoint that answers 500, and one whose receipts fail, log a line and the next event still sends.
- `pnpm test` clean.

## Resume

- **Done:** implemented 2026-10-09. `packages/push/src/send.ts` is the Expo API alone: `ENDPOINT`, `RECEIPTS` and `BATCH` (100, the service's own limit), and `createSender({ log, gone, endpoint?, receipts?, request? })`, which keeps the tickets of its last send and reads their receipts at the top of the next `send`, before that send's POST - no timer, so a daemon nobody is waiting on reads nothing. Every failure is one `log` line and nothing thrown: a network that throws, a status that is not ok, a body that is not JSON, a ticket or receipt the service refused. `details.error: 'DeviceNotRegistered'` is the one refusal acted on, and it calls `gone(token)`. `packages/push/src/plugin.ts` is the wiring: `optionsSchema` with `title` and `accessToken` (`writeOnly`, `secretAtUse`), a `session_start` and `session_opened` subscription filling one map of session to client ids, an `input_needed_set` subscription that forgets nothing about a pair it has seen, and an `input_needed_removed` subscription that forgets the pair. `packages/push/src/index.ts` re-exports `createSender`, `ENDPOINT`, `RECEIPTS`, `BATCH` and the `PushMessage`, `SendOptions` and `Sender` types.
- **Readings the plan leaves to the task:** `AWAITS_PERSON` is `chatInput`, `toolConfirmation` and `toolAuthentication`, and `toolClientExecution` is not among them - the Goal says a session "starts waiting on a person", and `code://packages/sdk/src/types/events.ts#L126-L134` says a `toolClientExecution` is not one and that a plugin reading for a person reads `kind`. The `(session, id)` pair is marked seen *before* the send, on the literal reading of step 1 - so a send that failed is not retried for that pair, and a *different* pair after it sends normally. The `opened` map and the `told` set are never pruned: there is no `session_end` subscription, so a long-lived daemon grows them by one entry per session and per wait. Neither is a departure from a decision, and both are noted here rather than decided silently.
- **Tests:** `packages/push/test/send.test.ts`, 12 cases against a stubbed `globalThis.fetch` - two clients' devices are two messages in one request and a third device hears nothing; `title` is the daemon's name or the option; `toolConfirmation` asks for approval; `toolClientExecution` sends nothing; a repeated pair sends nothing while the same id of another session sends; a removal sends nothing and makes the pair new again; the previous send's receipts are read before this one's POST and none before the first; `DeviceNotRegistered` removes the device from `push-devices.json`; a `$secret` the vault does not hold logs one line, makes no request and is not retried for that pair, and the next wait after the vault holds it sends with `Bearer`; a 500 and a receipt read that throws each log a line and let the next wait send; 101 devices are a 100-message request and a 1-message request.
- **Gates:** `npx vitest run packages/push/test` (12 passing), `npx tsc -p tsconfig.json --noEmit` and `node scripts/boundary.mjs` (`@ahpd/push: 1 declared, none undeclared`) pass. The full gates run once task-03 is in.
- **Next action:** [task-03-docs.md](task-03-docs.md).
- **Open questions:** none.
- **Watch out for:** the plugin is applied over a host that is only recorded, so the tests fire events at the handlers it registered rather than through a socket - and the devices are a `push-devices.json` written before `apply`, which is what a restarting daemon finds. `createSender` takes `request` so a caller can hand it another, but the plugin does not use it: the suite stubs `globalThis.fetch` before `apply` because `createSender` captures its request at creation. The title falls back to `host.hostName` when the option is absent or blank.
