---
title: The tests offer a version both packages speak
status: done
depends: []
layer: "sdk, agent-acp, agent-cofold, agent-pi, server, scripts"
refs:
  - "[code://packages/sdk/test/host.test.ts#L238](../../../../packages/sdk/test/host.test.ts#L238) - one of the 40, `hello(['0.8.0'], ...)`"
  - "[code://scripts/acp-smoke.mts#L60](../../../../scripts/acp-smoke.mts#L60) - the smoke script's offer"
---

## Objective

No test or script offers `0.8.0` in `initialize`, so the suite passes on the 0.9.0 package now and on the 1.0.0 package after task 02.

## Files

- `UPDATE:` the 22 files `rg -l "protocolVersions: \['0.8.0'\]" packages examples` lists today: `packages/sdk/test/` `host.test.ts`, `example.test.ts`, `watches.test.ts`, `plugin-host.test.ts`, `plugin-events-fire.test.ts`, `plugin-events-order.test.ts`, `subscribe.test.ts`, `operations.test.ts`, `writes.test.ts`; `packages/agent-cofold/test/` `agent-cofold-models`, `-plugin`, `-usage`, `-client-tool`, `-approval`, `-fork`, `-turn`; `packages/agent-acp/test/` `agent-acp-ports`, `-plugin`, `-turn`; `packages/agent-pi/test/` `agent-pi-fork`, `-truncate`; `packages/server/test/plugin-end-to-end.test.ts`.
- `UPDATE: packages/sdk/test/host.test.ts` - besides its one literal offer, 92 calls go through `hello(['0.8.0'], ...)` (`rg -c "hello\(\['0\.8\.0'\]"`), and `:279-280` expects `0.8.0` back.
- `UPDATE: scripts/acp-smoke.mts:60` - offers `['0.9.0']`.

## Steps

1. Replace each `protocolVersions: ['0.8.0']` and each `hello(['0.8.0']` with `0.9.0`, the offer the other 107 literal calls already make.
2. A test whose subject is the version answered offers `[PROTOCOL_VERSION]` imported from the package and expects it back; `host.test.ts:279-280` (the connection still usable after `unsubscribe`) is the one found.
3. Leave the three handshake tests in `host.test.ts:211-234` to task 02, which rewrites them.
4. Leave every other `'0.8.0'` in `packages/server/test`: in `plugin-install`, `plugin-compat` and `server-configure` it is ahpd's own package version, not a protocol version.

## Validation

- `rg -n "protocolVersions: \['0\.8\.0'\]|hello\(\['0\.8\.0'\]" packages examples scripts` finds nothing.
- `pnpm test` passes on the installed 0.9.0 package.

## Resume
