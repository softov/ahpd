---
title: A phone hears when a session needs a person
domain: plugin
status: planned
priority: high
created: 2026-10-02
revalidated: 2026-10-02
requires:
  - plans/plugin/17-a-plugin-hears-a-session-needs-a-person/plan.md
changes: []
creates: []
decisions:
  - decisions/a-device-registers-for-push-by-writing-a-resource.md
refs:
  - "[code://packages/sdk/src/types/events.ts#L105-L115](../../../../packages/sdk/src/types/events.ts#L105-L115) - `InputNeededSetEvent`: session, chat, id, kind"
  - "[code://packages/sdk/src/host.ts#L5555-L5572](../../../../packages/sdk/src/host.ts#L5555-L5572) - `advertisedSchemes`, which advertises `push` once it is registered"
  - "[code://packages/computer/src/plugin.ts#L366](../../../../packages/computer/src/plugin.ts#L366) - the pattern: a package that registers a resource provider"
  - "[code://docs/PLUGINS.md#L700-L746](../../../../docs/PLUGINS.md#L700-L746) - a host-owned URI scheme and its write half"
  - https://docs.expo.dev/push-notifications/sending-notifications/ - the Expo push API: `POST https://exp.host/--/api/v2/push/send`, tickets and receipts
---

## Goal

A plugin, `@ahpd/push`, sends a push notification to every registered device when a session starts waiting on a person, so a phone hears it with its app closed.
A device registers by writing its push token to the plugin's `push:` scheme.

## Reconnaissance

The files read are the `refs` above.

### Searches performed

- `rg -n "input_needed" packages/sdk/src` - the two events plugin/17 built.
- `rg -n "resourceWrite" packages/sdk/src/host.ts` - writes are gated `file:write`.

### Runtime path

```
client resourceWrite push://devices/<id> -> push provider -> devices file
backend session/inputNeededSet -> emit -> input_needed_set -> push plugin -> Expo push API -> APNs / FCM -> the device
```

### Gaps

- Nothing on the host sends a notification anywhere.
- `Not found: a push or notify plugin - searched packages/ and plugin/17's deferred items` - plugin/17 left the notify plugin for later.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A device registers for push by writing a resource the push plugin serves](../../../decisions/a-device-registers-for-push-by-writing-a-resource.md) | proposed, defaulted 2026-10-02 |

| What | Source | Task |
| --- | --- | --- |
| A host sends push itself through Expo's push service; no relay | Softov, 2026-10-02, asked "Push notifications: what should happen?": "Plan host-sent push" | 02 |
| One push per `input_needed_set` id; a repeated set of the same id sends nothing | [`code://packages/sdk/src/types/events.ts#L100-L103`](../../../../packages/sdk/src/types/events.ts#L100-L103) "Dedupe by `id`" | 02 |
| The notification says which host and that a session waits, never what it asks; `data` carries the session URI | (defaulted: Expo's service sees the text) | 02 |
| A device Expo reports `DeviceNotRegistered` for is removed | the Expo push API's receipts | 02 |
| No dependency: `fetch` to the Expo API | (defaulted: the API is one JSON POST) | 02 |

## Proposed architecture

- **Data flow** - `packages/push/src/provider.ts` serves `push://devices/<id>`: `write` stores `{ token, platform, lang }`, `read` returns it, `remove` deletes it, `list` lists ids; kept in `push-devices.json` in the daemon's state directory.
- **Event flow** - `plugin.ts` subscribes to `input_needed_set`; an id not seen before sends one message per device; `input_needed_removed` forgets the id.
- **Layer responsibilities** - provider: devices · sender: the Expo API, tickets, receipts · plugin: wiring and options (`title`, an Expo access token).
- **Source-of-truth files** - [`code://packages/sdk/src/types/events.ts`](../../../../packages/sdk/src/types/events.ts), [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A device registers under push:](task-01-a-device-registers-under-push.md) | todo | - |
| [02 - A waiting session is sent to every device](task-02-a-waiting-session-is-sent.md) | todo | 01 |
| [03 - The plugin is documented](task-03-docs.md) | todo | 02 |

## Risks and tradeoffs

- Expo's service is a third party that sees each notification; the text is kept to the host and the fact of waiting.
- A guest with read only cannot register (decision 1).
- A push token in a file is a credential to that device's notifications; the file is written `0600`.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-device-registers-under-push.md](task-01-a-device-registers-under-push.md).
- **Open questions:**
  1. Decision 1 is proposed: a resource write, or a new protocol command? - proposed: the resource write.
  2. Every session on the host, or only sessions a device's client created or opened? - proposed: every session first.
  3. Should `input_needed_removed` send a second message that clears the first on the device? - proposed: no, until a client asks for it.
- **Watch out for:** the events repeat for the same id (the protocol's upsert); dedupe, never count.

## Final verification checklist

- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm test` clean.
- [ ] A fixture backend's `inputNeededSet` sends exactly one request to a stubbed Expo endpoint per registered device.
- [ ] `plans/index.md` updated.
