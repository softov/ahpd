---
title: A device registers under push
status: done
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

- **Done:** implemented 2026-10-09. `packages/push` is a package like `@ahpd/computer`'s: `package.json` (peer `@ahpd/sdk >=0.10`, `ahpd.entry`, `ahpd.title` Push), `tsconfig.json`, `src/index.ts`, `src/plugin.ts` (`name: 'ahpd-push'`, one `registerResourceProvider('push', ...)`) and `src/provider.ts`. The provider serves three places and no leaves - `push://`, `push://devices` and `push://devices/<id>` - with `describe`, `list`, `resolve`, `read`, `write` and `remove`; a write is JSON with a non-empty `token` and a `platform` of `ios` or `android`, everything else `-32602`, and `createOnly` on one that is there is `-32010`. Devices go in `push-devices.json` under `host.configDir`, read at load and written whole through `writeJsonAtomic`, which leaves the file `0600`.
- **Beyond the task's Files:** a device also keeps the writing client's id, which the host hands `write` since task-04 - it is the whole point of that task, and the send in task-02 reads it. The root `package.json` build script gained `tsc -p packages/push`, which no task listed: without it `pnpm build` skips the new package, and its `ahpd.entry` names `dist`.
- **Tests:** `packages/push/test/provider.test.ts`, 9 cases - write then read; the file is `0600`; a re-registration replaces; ten bodies that are not a device; a write naming no device, and `createOnly`; remove then list, and a second remove; a writer that named no client; a file that is not JSON reported without quoting the token; and a host with the plugin advertising `push` with `get`, `list`, `resolve`, `put`, `delete` and serving a registration through `resourceWrite`.
- **Gates:** `npx tsc -p tsconfig.json --noEmit`, `node scripts/boundary.mjs` (`@ahpd/push: 1 declared, none undeclared`) and `pnpm build` all pass.
- **Next action:** [task-02-a-waiting-session-is-sent.md](task-02-a-waiting-session-is-sent.md).
- **Open questions:** none.
- **Watch out for:** the advertised operation words are the host's own - `get`, `list`, `resolve`, `put`, `delete` - not the plan's prose words. `splitResource` from the sdk is what refuses a URI of another scheme with `-32602`. `resolve` answers a device that is not there with the shape of one, as `records.ts` does, so a client can draw a registration form before it writes; `read` is the one that says nothing is there.
