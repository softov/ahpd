---
title: A waiting session is sent to every device
status: todo
depends:
  - task-01-a-device-registers-under-push.md
layer: "push"
refs:
  - "[code://packages/sdk/src/types/events.ts#L105-L115](../../../../packages/sdk/src/types/events.ts#L105-L115) - the event this sends on"
  - https://docs.expo.dev/push-notifications/sending-notifications/ - the request, tickets and receipts
---

## Objective

Each new `input_needed_set` id sends one Expo push message to every registered device, and a device Expo no longer knows is removed.

## Files

- `CREATE: packages/push/src/send.ts` - batches of up to 100 messages to `https://exp.host/--/api/v2/push/send`, then the receipts.
- `UPDATE: packages/push/src/plugin.ts` - subscribes to `input_needed_set` and `input_needed_removed`; options `title` (default the daemon's name) and `accessToken`.
- `CREATE: packages/push/test/send.test.ts` - against a stubbed endpoint.

## Steps

1. Keep the ids seen; a repeated id sends nothing; a removal forgets it.
2. A message is `{ to, title, body, data: { uri: <session>, kind } }`; the body is "A session is waiting for your answer" or, for `toolConfirmation`, "A session is waiting for your approval".
3. Read the receipts and remove devices reported `DeviceNotRegistered`.

## Validation

- `send.test.ts`: one set to two devices is two messages in one request; the same id again sends nothing; `DeviceNotRegistered` removes the device.
- `pnpm test` clean.

## Resume
