---
title: A browser gets a push
domain: plugin
status: built
priority: medium
created: 2026-10-31
revalidated: 2026-10-31
requires:
  - plans/plugin/33-a-phone-hears-a-session-needs-a-person/plan.md
changes: []
creates: []
refs:
  - git://fff9c888 - the commit of ahpd this plan was checked at, and the last one that holds the brief `.project/briefs/a-browser-gets-a-push.md`
  - git://fff9c888:.project/briefs/a-browser-gets-a-push.md - the brief this plan covers, with the standards and the open points
  - "[code://packages/push/src/provider.ts#L40-L72](../../../../packages/push/src/provider.ts#L40-L72) - the registration body and `Device`"
  - "[code://packages/push/src/provider.ts#L116-L143](../../../../packages/push/src/provider.ts#L116-L143) - `shownOf`, which hides the token, and `kept`, which reads a stored device"
  - "[code://packages/push/src/provider.ts#L209-L244](../../../../packages/push/src/provider.ts#L209-L244) - `PushProvider` and `deviceOf`, which refuses a platform that is not `ios` or `android`"
  - "[code://packages/push/src/provider.ts#L313-L324](../../../../packages/push/src/provider.ts#L313-L324) - `write`, which stores the device with the writer's client id"
  - "[code://packages/push/src/plugin.ts#L85-L95](../../../../packages/push/src/plugin.ts#L85-L95) - `audience`, the devices whose client created or opened a session"
  - "[code://packages/push/src/plugin.ts#L114-L134](../../../../packages/push/src/plugin.ts#L114-L134) - `notify`, which makes one Expo message per device"
  - "[code://packages/push/src/send.ts#L28-L78](../../../../packages/push/src/send.ts#L28-L78) - the Expo endpoint, `PushMessage` and `Sender`, the seam to copy for the web sender"
  - "[code://packages/push/src/send.ts#L132-L141](../../../../packages/push/src/send.ts#L132-L141) - `refused`, which removes a device that Expo says is not registered"
  - "[code://packages/sdk/src/types/resources.ts#L155-L176](../../../../packages/sdk/src/types/resources.ts#L155-L176) - `write` is handed `owner`, the person, and `client`, the window"
  - "[code://packages/sdk/src/types/plugin.ts#L995](../../../../packages/sdk/src/types/plugin.ts#L995) - `sessionOwner`, the person a session belongs to"
  - "[code://packages/push/package.json#L60-L86](../../../../packages/push/package.json#L60-L86) - no runtime dependency, and the options"
  - https://www.rfc-editor.org/rfc/rfc8030.html - Web Push protocol, sections 5.2 to 5.4 and 7.3
  - https://www.rfc-editor.org/rfc/rfc8291.html - message encryption, and the test vectors of its appendix A
  - https://www.rfc-editor.org/rfc/rfc8292.html - VAPID, sections 2 to 4
  - https://nodejs.org/api/crypto.html - `createECDH`, `hkdfSync`, `aes-128-gcm` and `ieee-p1363` ES256 signatures
  - file:///github/ahpw/.project/plans/shell/20261031-0804-a-browser-gets-a-push/plan.md - the ahpw plan that registers a browser
---

## Goal

`@ahpd/push` sends to a browser through the browser's Web Push service, as it sends to a phone through Expo.
The events, the text and the once-per-pair rule stay as they are.
Each device gets a setting for which sessions it hears about: every session of its person, or only the sessions this device opened.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "SessionStartEvent|SessionOpenedEvent|ClientConnectEvent" packages/sdk/src/types/events.ts` - the session events name a client and never a person.
- `rg -n "sessionOwner" packages/sdk/src` - the host answers a session's owner to a plugin.
- `rg -n "jose|web-push" pnpm-lock.yaml packages/*/package.json` - no Web Push package, and `jose` only through `@modelcontextprotocol/sdk`.

### Runtime path

```
browser resourceWrite push://devices/<id> {platform: web, endpoint, keys} -> push provider -> push-devices.json
backend input_needed_set or turn_end -> push plugin -> audience by person or by device
  -> Expo device: Expo sender -> APNs or FCM
  -> web device: web sender -> RFC 8291 body, VAPID header -> the endpoint's push service -> the browser's service worker
```

### Gaps

- `platform` is fixed to `ios` or `android`, and a device holds an Expo token only.
- No VAPID key pair, and no place where a browser reads the public key.
- No sender for a Web Push endpoint.
- A device stores its client, not its person, so a device hears only the sessions its own client created or opened.
- ahpw's client id is new on each page load, so the device rule alone sends nothing to a browser after a reload.
  The ahpw plan keeps the id per host.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The web sender encrypts and signs with `node:crypto`, with no new dependency | Softov, 2026-10-31, chose "node:crypto (Recommended)" | 03 |
| Each device has a setting: `person`, every session its person created or opened, or `device`, only the sessions this device opened; the default is `person` | Softov, 2026-10-31, chose "A setting per device (Recommended)": "Each device record gets a setting: every session its person created or opened, or only those this device opened. The default is every session of the person" | 01 |
| `person` sends a session to a device when its person is the session's owner, or when its client created or opened the session | (defaulted: `sessionOwner` names the person of a session, and the session events name only clients) | 01 |
| `device` sends a session to a device when its client created or opened the session, which is the rule of today | [`code://packages/push/src/plugin.ts#L85-L95`](../../../../packages/push/src/plugin.ts#L85-L95) | 01 |
| A device keeps the writer's `owner` from `write`; a device with no owner falls back to the `device` rule | (defaulted: `owner` is absent on a host with no users) | 01 |
| A browser device is `{ platform: 'web', endpoint, keys: { p256dh, auth }, lang?, audience? }`; `audience` is allowed on every platform | (defaulted: the fields of a subscription's `toJSON()`, Push API section 8) | 01, 02 |
| `endpoint` and `keys` are never read back, as a token is not | (defaulted: an endpoint is a capability URL to the device) | 02 |
| One VAPID key pair per host, in `push-vapid.json` under `host.configDir`, mode `0600`, made at the first load | (defaulted: the device file is kept the same way) | 02 |
| A browser reads the public key from `push://vapid`, a read-only record `{ "publicKey": "<base64url>" }` | (defaulted: a record keeps the `push` scheme as the one place a client reads) | 02 |
| A web message carries the same title, body and `data` as an Expo message | (defaulted: [`code://packages/push/src/plugin.ts#L21-L24`](../../../../packages/push/src/plugin.ts#L21-L24); a lock screen still shows it) | 03 |
| `TTL` is 86400 seconds; `Urgency` is `high` for a wait and `normal` for a finished turn; `Topic` is a hash of the session URI | (defaulted: RFC 8030 sections 5.2 to 5.4; a `Topic` holds at most 32 base64url characters) | 03 |
| A 404 or 410 from a push service removes the device | RFC 8030 section 7.3 | 03 |
| An endpoint must be `https:` on a host in the `webPushHosts` option | (defaulted: the endpoint comes from a client, so an open list is a request the host makes to any address) | 03 |
| `webPushHosts` defaults to `*.push.apple.com`, `fcm.googleapis.com`, `updates.push.services.mozilla.com` and `*.notify.windows.com` | (defaulted: the push services of Safari, Chrome, Firefox and Edge) | 03 |
| A `contact` option is sent as the VAPID `sub` claim when it is given | RFC 8292 section 2.1 | 03 |
| ahp-desk shows alerts itself and gets no Web Push | Softov, 2026-10-31, chose "Desk shows them natively (Recommended)" | - |

## Proposed architecture

- **Data flow** - `provider.ts` keeps `owner` and `audience` on every device, and `endpoint` and `keys` on a web device. It serves `push://vapid` from `vapid.ts`.
- **Event flow** - the events do not change. `audience` reads `sessionOwner` once per send and picks the devices by their setting.
- **State flow** - `push-devices.json` gains three fields. `push-vapid.json` is new and holds the key pair.
- **Layer responsibilities** - `provider.ts`: devices, `push://vapid` · `vapid.ts`: key pair · `webpush.ts`: RFC 8291, VAPID, POST · `send.ts`: Expo · `plugin.ts`: audience, dispatch.
- **Source-of-truth files** - [`code://packages/push/src/plugin.ts`](../../../../packages/push/src/plugin.ts), [`code://packages/push/src/provider.ts`](../../../../packages/push/src/provider.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A device hears its person's sessions](task-01-a-device-hears-its-persons-sessions.md) | done | - |
| [02 - A browser registers under push](task-02-a-browser-registers-under-push.md) | done | 01 |
| [03 - A browser is sent a push](task-03-a-browser-is-sent-a-push.md) | done | 02 |
| [04 - The plugin is documented](task-04-docs.md) | done | 03 |

## Risks and tradeoffs

- The default `person` widens what an ahpapp phone hears today: its person's other sessions too. ahpapp gets the switch in a follow-up plan.
- A device stored before this plan has no owner. It keeps the rule of today until its client writes it again, and ahpapp writes on each connect.
- `person` does not reach a session that the person opened from another client and does not own. The session events name no person.
- A push service sees which host talks to which browser, and when (RFC 8291 section 7).
- A host with a removed `push-vapid.json` makes a new key pair, and every browser subscription fails until each browser subscribes again.

## Resume state

- **Done so far:** drafted 2026-10-31; Softov sent it to build the same day. Task 01 is implemented: a device keeps its person and an `audience`, and `audience` reads `sessionOwner` once per send. Task 02 is implemented: a browser registers under `platform: 'web'`, the host keeps a VAPID pair in `push-vapid.json`, and `push://vapid` serves its public key. Task 03 is implemented: `webpush.ts` seals an RFC 8291 `aes128gcm` body (its appendix A vector matches byte for byte) and signs a VAPID ES256 header, `notify` splits phones and browsers, and a 404 or 410 removes the device. Task 04 is implemented: the README and the plugin page name the web body, `push://vapid`, `audience`, `webPushHosts` and `contact`.
- **Next action:** none; every task is done. The review fixed a seal that threw out of `send`, and PR #171 merged as `9c2fe3d1`. Chrome and Firefox passed by hand on 2026-11-09. The Safari check is in [macos-checks.md](../../../pending/macos-checks.md), and `implemented.md` records the build.
- **Open questions:** none.
- **Watch out for:** Not checked: whether Apple's push service refuses a VAPID JWT with no `sub`. If it does, `contact` needs a default.

## Final verification checklist

- [ ] The web sender's encryption matches the RFC 8291 appendix A vector byte for byte.
- [x] A Chrome and a Firefox subscription from ahpw get a notification with the tab closed.
- [x] A `device` device does not hear a session that another client of its person created.
- [ ] A `person` device hears a session that another client of its person created.
- [ ] A 410 from a push service removes the device.
- [ ] An endpoint off the `webPushHosts` list is refused at the write.
- [ ] `pnpm typecheck`, `pnpm boundary` and the push suite pass, and Windows CI is green.
