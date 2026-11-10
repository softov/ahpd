---
title: A browser gets a push - implemented
date: 2026-10-31
refs:
  - "[code://packages/push/src/provider.ts](../../../../packages/push/src/provider.ts) - the device bodies, `push://vapid` and the endpoint check"
  - "[code://packages/push/src/plugin.ts](../../../../packages/push/src/plugin.ts) - the audience and the dispatch by platform"
  - "[code://packages/push/src/vapid.ts](../../../../packages/push/src/vapid.ts) - the host's VAPID pair"
  - "[code://packages/push/src/webpush.ts](../../../../packages/push/src/webpush.ts) - RFC 8291, VAPID and the POST"
---

`@ahpd/push` sends to a browser through its Web Push service, as it sends to a phone through Expo. A browser registers `{ platform: "web", endpoint, keys }` under `push://devices`, and reads the host's public key from `push://vapid`. It hears about the sessions its person owns or its client created or opened. A device chooses between `person` and `device` with its `audience`, and `person` is the default.

## What was built

- [`code://packages/push/src/provider.ts`](../../../../packages/push/src/provider.ts) - `Device` is a union of an Expo device and a web device. A web body is an `https:` endpoint on a host that `webPushHosts` allows, with two keys. Its `p256dh` is a P-256 point, and its `auth` is 16 octets. `shownOf` hides the token, or the endpoint and keys. `push://vapid` is a read-only record `{ publicKey }`, refused `-32008` when the host has no pair. `write` stores the writer's `owner` and the device's `audience`.
- [`code://packages/push/src/vapid.ts`](../../../../packages/push/src/vapid.ts) - one P-256 pair per host in `push-vapid.json`, written `0600`, made at the first load. The public key is the 65-octet point in base64url.
- [`code://packages/push/src/webpush.ts`](../../../../packages/push/src/webpush.ts) - `encrypt` seals a payload with RFC 8291 `aes128gcm` from `node:crypto`. `vapidHeader` signs `{ aud, exp, sub? }` with ES256 in `ieee-p1363`. `createWebSender` POSTs one sealed message per device with `TTL: 86400`, `Urgency` and a `Topic` hashed from the session, and removes a device on 404 or 410. A message that cannot be sealed is logged, and the next device still gets its push. A redirect is refused, so a push service cannot send the request to a host that `webPushHosts` does not allow.
- [`code://packages/push/src/plugin.ts`](../../../../packages/push/src/plugin.ts) - `audience` reads `sessionOwner` once per send and picks by person or by client. `notify` sends phones through the Expo sender and browsers through the web sender.
- `packages/push/test/webpush.test.ts` holds the RFC 8291 appendix A vector and the request the sender makes. `packages/push/test/vapid.test.ts`, `plugin.test.ts` and the added provider cases cover the pair, the audience and the web body.
- `packages/push/README.md` and `package.json` document the web body, `push://vapid`, `audience`, `webPushHosts` and `contact`.

## Verified

- The RFC 8291 appendix A body matches byte for byte, and the test derives each public key from its private key first.
- `pnpm typecheck` is clean at each of the four commits.
- `node scripts/boundary.mjs` prints `@ahpd/push: 1 declared, none undeclared`.
- `pnpm vitest run packages/push/test` passes 5 files and 45 tests.
- `pnpm build` passes, and `pnpm docs:build` completes in 16.96s.
- `node .agents/skills/do-spec/scripts/lint-prose.mjs docs/plugins/push.md` prints nothing. The same linter on the README reports four long lines, all of them before this plan.
- `packages/sdk/test/fixtures/wire.jsonl` was not rewritten.

## Departures from the plan

- `docs/plugins/push.md` is an include of the README, so the page itself did not change. The content is in `packages/push/README.md`, which the page renders.
- A `push-vapid.json` that exists but does not hold a P-256 JWK is not replaced. The plugin logs one line and serves no `push://vapid`. A host with a broken file does not rotate the key under every subscription on each load.
- The provider also checks the subscription's keys, not only the endpoint host. A `p256dh` that is not an uncompressed P-256 point, or an `auth` that is not 16 octets, is refused `-32602`.
- `contact` is not validated beyond being a non-blank string. When it is given, it is sent as `sub` on every request.

## Checks by hand

Softov ran the checks on a test daemon from main on 2026-11-09, and they passed in Chrome and in Firefox. The check was `pending/push-web-checks.md`, last held at git://2c9bb2717.

## Left for later

- A Safari subscription, which answers whether Apple needs a `sub` claim. It is *Push in Safari* in [macos-checks.md](../../../pending/macos-checks.md).
- Windows CI is not run here. The plan's checklist still says it should be green.
- The whole repo suite was not run. The push package, the typecheck, the boundary check, the build and the docs build were.
