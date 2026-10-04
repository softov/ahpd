---
title: A device registers under push
status: todo
depends: [task-04-the-host-names-the-client.md]
layer: "push"
refs:
  - "[code://packages/computer/src/plugin.ts#L582](../../../../packages/computer/src/plugin.ts#L582) - how a package registers its provider"
  - "[code://packages/computer/package.json](../../../../packages/computer/package.json) - the manifest shape to copy"
  - "[code://packages/sdk/src/types/plugin.ts#L98-L105](../../../../packages/sdk/src/types/plugin.ts#L98-L105) - `configDir`"
---

## Objective

`@ahpd/push` loads as a plugin, `push` appears in `_meta.ahpd.resourceProviders`, and a client can write, read, list and remove `push://devices/<id>`.

## Files

- `CREATE: packages/push/package.json` - `@ahpd/push`, the manifest like `@ahpd/computer`'s.
- `CREATE: packages/push/src/plugin.ts` - registers the provider.
- `CREATE: packages/push/src/provider.ts` - `read`, `list`, `resolve`, `write`, `remove` over `push-devices.json`, written `0600`.
- `CREATE: packages/push/test/provider.test.ts` - the cases below.

## Steps

1. Copy `@ahpd/computer`'s package shape.
2. A write is JSON with a non-empty `token` and `platform` of `ios` or `android`; anything else is refused `-32602`.
3. Keep the file at `join(host.configDir, 'push-devices.json')`, read at load, written on each change.

## Validation

- `packages/push/test/provider.test.ts`: write then read returns the device; a bad body is refused; remove then list is empty; the file is `0600`.
- A daemon with the plugin advertises `push` with `read`, `list`, `resolve`, `write` and `delete`.

## Resume
