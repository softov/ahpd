---
title: A phone hears when a session needs a person
domain: plugin
status: built
priority: high
created: 2026-10-02
revalidated: 2026-10-04
requires:
  - plans/plugin/17-a-plugin-hears-a-session-needs-a-person/plan.md
changes: []
creates: []
decisions:
  - decisions/a-device-registers-for-push-by-writing-a-resource.md
  - decisions/a-push-token-is-write-only.md
refs:
  - "[code://packages/sdk/src/types/events.ts#L105-L116](../../../../packages/sdk/src/types/events.ts#L105-L116) - `InputNeededSetEvent`: session, chat, id, kind"
  - "[code://packages/sdk/src/host/root.ts#L171-L185](../../../../packages/sdk/src/host/root.ts#L171-L185) - `advertisedSchemes`, which advertises `push` once it is registered"
  - "[code://packages/computer/src/plugin.ts#L582](../../../../packages/computer/src/plugin.ts#L582) - the pattern: a package that registers a resource provider"
  - "[code://docs/PLUGINS.md#L868-L914](../../../../docs/PLUGINS.md#L868-L914) - a host-owned URI scheme and its write half"
  - "[code://packages/sdk/src/types/plugin.ts#L98-L105](../../../../packages/sdk/src/types/plugin.ts#L98-L105) - `configDir`, where a plugin keeps a record of its own"
  - "[code://packages/sdk/src/types/plugin.ts#L180](../../../../packages/sdk/src/types/plugin.ts#L180) - `secret(name, work?)`, how a plugin reads a `secretAtUse` value"
  - "[code://packages/computer/src/plugin.ts#L57-L61](../../../../packages/computer/src/plugin.ts#L57-L61) - `needValue`, the `secretAtUse` pattern"
  - https://docs.expo.dev/push-notifications/sending-notifications/ - the Expo push API: `POST https://exp.host/--/api/v2/push/send`, tickets and receipts
---

## Goal

A plugin, `@ahpd/push`, sends a push notification to a registered device when a session that device's client created or opened starts waiting on a person, so a phone hears it with its app closed.
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
- `Not found: which client created or opened a session - searched packages/sdk/src/types/events.ts and packages/sdk/src/types/resources.ts` - `client_connect` names only the client, `session_start` names no client, and a provider's `write` is handed the writer's `owner`, not its client.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A device registers for push by writing a resource the push plugin serves](../../../decisions/a-device-registers-for-push-by-writing-a-resource.md) | Softov, 2026-10-04 |
| 2 | [A push token is write-only](../../../decisions/a-push-token-is-write-only.md) | Softov, 2026-10-10 |

| What | Source | Task |
| --- | --- | --- |
| A host sends push itself through Expo's push service; no relay | Softov, 2026-10-02, asked "Push notifications: what should happen?": "Plan host-sent push" | 02 |
| The host names the client: `session_start` carries the creating client's id, a `session_opened` event names a client that subscribes, and a provider's `write` is handed the writing client's id | Softov, 2026-10-04, asked "How does the push plugin learn which client created or opened a session?": the host names the client | 04 |
| A device is sent only the sessions its client created or opened | Softov, 2026-10-04, asked "Every session on the host, or only sessions a device's client created or opened?": only the sessions that device's client created or opened | 02 |
| `input_needed_removed` sends no second message to clear the first, until a client asks for one | Softov, 2026-10-04, asked "Should `input_needed_removed` send a second message that clears the first on the device?": no, until a client asks for one | 02 |
| Receipts are read at the next send, for the tickets the previous send left; no timer | Softov, 2026-10-04, asked "When are the receipts read: on a timer after each send, or at the next send, for the tickets the previous one left?": at the next send | 02 |
| One push per `input_needed_set` `(session, id)` pair; a repeated set of the same pair sends nothing | [`code://packages/sdk/src/types/events.ts#L100-L103`](../../../../packages/sdk/src/types/events.ts#L100-L103) "Dedupe by `id`", keyed with the session because an id is the backend's and two sessions may share one | 02 |
| `accessToken` is declared `secretAtUse: true` and `writeOnly: true`, read with `host.secret` at each send; a secret that cannot be read fails that send with a log line and nothing else | Softov, 2026-10-03, asked "when a `$secret` in a plugin's options can't be read at load, what fails?": "Only its item" | 02 |
| A failed POST or receipt read is logged and never throws; the plugin and the next send carry on | Softov, 2026-10-03, "Only its item": a failure belongs to the item that failed | 02 |
| Devices are kept in `push-devices.json` under `host.configDir` | [`code://packages/sdk/src/types/plugin.ts#L98-L105`](../../../../packages/sdk/src/types/plugin.ts#L98-L105) | 01 |
| The notification says which host and that a session waits, never what it asks; `data` carries the session URI | (defaulted: Expo's service sees the text) | 02 |
| A device Expo reports `DeviceNotRegistered` for is removed | the Expo push API's receipts | 02 |
| No dependency: `fetch` to the Expo API | (defaulted: the API is one JSON POST) | 02 |

## Proposed architecture

- **Data flow** - `packages/push/src/provider.ts` serves `push://devices/<id>`: `write` stores `{ token, platform, lang }`, `read` returns it, `remove` deletes it, `list` lists ids; kept in `push-devices.json` under `host.configDir`.
- **Event flow** - `plugin.ts` subscribes to `input_needed_set`; a `(session, id)` not seen before sends one message to each device whose client created or opened that session; `input_needed_removed` forgets the pair and sends nothing.
- **Layer responsibilities** - provider: devices · sender: the Expo API, tickets, and the previous send's receipts read at the next send · plugin: wiring and options (`title`, an Expo access token).
- **Source-of-truth files** - [`code://packages/sdk/src/types/events.ts`](../../../../packages/sdk/src/types/events.ts), [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A device registers under push:](task-01-a-device-registers-under-push.md) | done | 04 |
| [02 - A waiting session is sent to the devices whose client created or opened it](task-02-a-waiting-session-is-sent.md) | done | 01 |
| [03 - The plugin is documented](task-03-docs.md) | done | 02 |
| [04 - The host names the client that wrote, created or opened](task-04-the-host-names-the-client.md) | done | - |

## Risks and tradeoffs

- Expo's service is a third party that sees each notification; the text is kept to the host and the fact of waiting.
- A guest with read only cannot register (decision 1).
- A push token in a file is a credential to that device's notifications; the file is written `0600`.

## Resume state

- **Done so far:** tasks 01 to 04 built 2026-10-10.
- **Next action:** none; see [implemented.md](implemented.md).

## Final verification checklist

- [x] `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm test` clean.
- [ ] A fixture backend's `inputNeededSet` sends exactly one request to a stubbed Expo endpoint per registered device whose client created or opened the session, and none to a device whose client did neither.
- [x] `plans/index.md` updated.
