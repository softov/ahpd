---
title: A pushed key nobody declares is refused
status: todo
depends: [task-01-the-root-config-declares-the-keys-vscode-pushes.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L9852-L9990](../../../../packages/sdk/src/host.ts#L9852-L9990) - the `root/configChanged` handler: `config`, `apply`, the daemon half"
  - "[code://packages/sdk/src/host.ts#L6080-L6087](../../../../packages/sdk/src/host.ts#L6080-L6087) - the comment saying everything pushed is kept, which this task makes untrue"
  - "[code://packages/sdk/src/host.ts#L6131-L6137](../../../../packages/sdk/src/host.ts#L6131-L6137) - `daemonProperties` and `daemonKey`"
  - "[code://packages/sdk/test/root-config.test.ts#L203-L213](../../../../packages/sdk/test/root-config.test.ts#L203-L213) - 'refuses what the daemon would not take, naming the key', the rejection this one mirrors"
  - "[code://packages/sdk/test/conformance.test.ts#L486-L501](../../../../packages/sdk/test/conformance.test.ts#L486-L501) - the test that pushes `a` and `b`"
---

## Objective

A `root/configChanged` key that neither `ROOT_CONFIG_SCHEMA` nor the daemon's schema declares is not applied, not kept in `rootConfig` and not echoed; an action with no declared key left is rejected with a reason naming its keys.

## Files

- `UPDATE: packages/sdk/src/host.ts:9852-9990` - split `config` into declared and refused before the daemon half is asked; the rest of the handler reads only the declared part.
- `UPDATE: packages/sdk/src/host.ts:6080-6087` - the `rootConfig` comment says it holds only declared keys.
- `UPDATE: packages/sdk/test/root-config.test.ts` - the refusal cases.
- `UPDATE: packages/sdk/test/conformance.test.ts:486-501` - push declared keys (`telemetryLevel`, `autoReplyEnabled`) in place of `a` and `b`; the test's point, taking a key back with `null` and `replace`, is unchanged.

## Steps

1. A key is declared when it is in `ROOT_CONFIG_SCHEMA.properties` or `daemonKey(key)` is true, whoever is asking; `seesConfig` decides what a connection is shown, not what exists.
2. Compute `refused` before the daemon half. When `config` has keys and every one is refused, reject the dispatch through the same path a refused daemon write uses, with `root config does not declare <keys>`, and return.
3. Otherwise go on with `config` minus the refused keys, for a merge and for `replace: true` alike; the echo is built from that, so `seenBy` needs no change.
4. Log one line naming the refused keys, without their values.
5. An empty `config` (`{}`) is not a refusal; it is applied as today.

## Validation

- `packages/sdk/test/root-config.test.ts`: `{ telemetryLevel: 'off', nonsense: 1 }` echoes `{ telemetryLevel: 'off' }` and root `values` has no `nonsense`; `{ nonsense: 1 }` is answered with a `rejectionReason` containing `nonsense` and no echo; `{ activeAgentTitleGeneration: true }` is rejected the same way; `replace: true` with `{ telemetryLevel: 'off', nonsense: 1 }` leaves `values` as `{ telemetryLevel: 'off' }`; a daemon key and an undeclared key together send only the daemon key to the port.
- `pnpm exec vitest run packages/sdk/test/root-config.test.ts packages/sdk/test/conformance.test.ts` passes.
- `pnpm test` passes.

## Resume
