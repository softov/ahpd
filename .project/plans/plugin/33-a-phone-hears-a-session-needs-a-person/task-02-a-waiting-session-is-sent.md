---
title: A waiting session is sent to the devices whose client created or opened it
status: todo
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
