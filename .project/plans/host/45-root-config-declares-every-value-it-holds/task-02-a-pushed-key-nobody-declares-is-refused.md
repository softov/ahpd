---
title: A pushed key nobody declares is refused
status: done
depends: [task-01-the-root-config-declares-the-keys-vscode-pushes.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/actions.ts#L220-L359](../../../../packages/sdk/src/host/actions.ts#L220-L359) - the `root/configChanged` handler: `config`, `apply`, the daemon half"
  - "[code://packages/sdk/src/host/root.ts#L108-L113](../../../../packages/sdk/src/host/root.ts#L108-L113) - the comment saying everything pushed is kept, which this task makes untrue"
  - "[code://packages/sdk/src/host/root.ts#L157-L162](../../../../packages/sdk/src/host/root.ts#L157-L162) - `daemonProperties` and `daemonKey`"
  - "[code://packages/sdk/test/root-config.test.ts#L203-L213](../../../../packages/sdk/test/root-config.test.ts#L203-L213) - 'refuses what the daemon would not take, naming the key', the rejection this one mirrors"
  - "[code://packages/sdk/test/conformance.test.ts#L486-L501](../../../../packages/sdk/test/conformance.test.ts#L486-L501) - the test that pushes `a` and `b`"
---

## Objective

A `root/configChanged` key that neither `ROOT_CONFIG_SCHEMA` nor the daemon's schema declares is not applied, not kept in `rootConfig` and not echoed; an action with no declared key left is rejected with a reason naming its keys.

## Files

- `UPDATE: packages/sdk/src/host/actions.ts:220-359` - split `config` into declared and refused before the daemon half is asked; the rest of the handler reads only the declared part.
- `UPDATE: packages/sdk/src/host/root.ts:108-113` - the `rootConfig` comment says it holds only declared keys.
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

Built on 2026-10-09, uncommitted on `build/agents/db49ec10`.

- `Root` gained `declaresConfigKey(key)` beside `daemonKey`. It answers true for a key in `ROOT_CONFIG_SCHEMA.properties` or for one the daemon port declares, and false with no daemon port. The handler in `actions.ts` asks it and nothing else, so what a connection is *shown* (`seesConfig`) does not decide what exists.
- The `root/configChanged` handler splits the pushed map before the daemon half. Every key `declaresConfigKey` refuses is dropped, and one log line names them without their values. The rest of the handler - the daemon write, the merge, `replace: true`, the echo - reads only what is left. `seenBy` is unchanged, which is the point: the echo is built from the filtered map.
- When the push has keys and every one is refused, the handler returns `Promise.reject(new Error('root config does not declare <keys>'))`. `behind` catches that, logs it as `a dispatch from <clientId> failed: <reason>` and answers `refuse`. The rejection reason reaches that one connection with the original `action`, no `serverSeq` and nothing buffered. It is the path a refused daemon write already takes, which is what step 2 asked for.
- An empty `config` is applied as today. The guard is `Object.keys(pushed).length > 0`, so `{}` never reaches the refusal.
- Tests: `root-config.test.ts` has four new cases:
  - 'refuses an undeclared key and applies the rest of the push'
  - 'rejects a push whose every key is undeclared, naming them'
  - 'keeps only declared keys when a push replaces the lot'
  - 'asks the daemon for its key alone when an undeclared key is beside it'
- `conformance.test.ts`'s 'takes a key back, and replaces the lot' pushes `telemetryLevel` and `autoReplyEnabled` in place of `a` and `b`. The point of that test - `null` taking a key back and `replace` clearing the rest - is unchanged.
- **The refusal reaches the protocol's own cases too, and that is expected.** `ahp-test-cases.test.ts` names `127-root-configchanged-merges-into-config-values`, `128-root-configchanged-noops-when-config-undefined` and `130-root-configchanged-replace-replaces-all-values` in `HOST_REFUSED`, and drops them from `HOST_OWNS`. They push `{"theme": "dark"}`, which no schema here declares. Softov decided this on 2026-10-09, and the plan's second table under *Decisions locked in* carries the answer.

**Forced move, reported:** `conformance.test.ts:439-472` pushed `githubEnterpriseUri`, which is not one of the 43 and is now refused; task 02's Files line named `:486-501` alone. Moved the push to `telemetryLevel`, the nearest declared key, rather than declaring a test-only key.

## Open questions

None.
