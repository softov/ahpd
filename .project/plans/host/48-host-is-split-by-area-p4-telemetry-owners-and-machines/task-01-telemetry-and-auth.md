---
title: Telemetry and sign-in requirements are their own files
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L1305-L1432](../../../../packages/sdk/src/host.ts#L1305-L1432) - the host's log and OTLP channels"
  - "[code://packages/sdk/src/host.ts#L2123-L2179](../../../../packages/sdk/src/host.ts#L2123-L2179) - turns and tool calls as spans and counters"
  - "[code://packages/sdk/src/host.ts#L2252-L2341](../../../../packages/sdk/src/host.ts#L2252-L2341) - `telemetered`"
  - "[code://packages/sdk/src/host.ts#L2095-L2121](../../../../packages/sdk/src/host.ts#L2095-L2121) - `asked`, `asking`"
  - "[code://packages/sdk/src/host.ts#L2998-L3055](../../../../packages/sdk/src/host.ts#L2998-L3055) - `loginId`, `resourcesOf`, `agentsFor`, `lent`"
  - "[code://packages/sdk/src/host.ts#L6993-L7034](../../../../packages/sdk/src/host.ts#L6993-L7034) - `advertised`, `metadataFor`, `channelAwaiting`"
---

## Objective

`host/telemetry.ts` exports `createTelemetry(ctx: HostContext): Telemetry` and `host/auth.ts` exports `createAuth(ctx: HostContext): Auth`, with the declarations above unchanged.

## Files

- `CREATE: packages/sdk/src/host/telemetry.ts` - `LOGS`, `TRACES`, `METRICS`, `telling`, `hex`, `attributed`, `startedAt`, `fire`, `logging`, `log`, `turning`, `calling`, `turnsRun`, `toolsRun`, `spanned`, `measured`, `telemetered`.
- `CREATE: packages/sdk/src/host/auth.ts` - `asked`, `asking`, `loginId`, `resourcesOf`, `agentsFor`, `lent`, `advertised`, `metadataFor`, `channelAwaiting`.
- `UPDATE: packages/sdk/src/host.ts` - those removed; both factories built before the first statement that calls `log` or `fire`.

## Steps

1. Move each declaration with its comment, unchanged but for indentation.
2. `telemetry.ts` reads `connections`, `options.events`, `options.onEvent` and what `measured` and `telemetered` read off `ctx`; `turnsRun`, `toolsRun` and `logging` stay local to the factory, since nothing else reads them.
3. `auth.ts` reads `options.users`, `agents`, `connections` and `dispatch` off `ctx`.
4. The factory's result is assigned onto `ctx`; `host.ts` destructures `log`, `fire`, `telemetered`, `turning`, `calling`, `measured`, `asking`, `lent`, `agentsFor`, `resourcesOf`, `advertised`, `metadataFor`, `channelAwaiting`.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass with no test changed; `test/otlp.test.ts` and `test/plugin-events-*.test.ts` cover telemetry and events.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume
