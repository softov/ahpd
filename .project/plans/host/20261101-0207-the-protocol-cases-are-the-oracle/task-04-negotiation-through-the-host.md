---
title: Negotiation through the host
status: todo
depends: [01]
layer: "sdk tests"
refs:
  - "[code://packages/sdk/test/ahp-test-cases.test.ts#L188-L239](../../../../packages/sdk/test/ahp-test-cases.test.ts#L188-L239) - the negotiation rows, run against the package's rule"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/versioning.md#L52-L68 - the rule, the baselines, and closing the connection"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/dotnet/tests/AgentHostProtocol.Tests/interop/session-host.ts#L85-L101 - the reference host's refusal"
---

## Objective

Every negotiation row goes through the host, and the host's answer is held to the row.
Where the host answers otherwise, a divergence entry names the row and the rule it breaks.

## Files

- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:188-239` - each row's host answer compared with the row, a refusal's `supportedVersions` with the protocol's baselines, and a refusal's connection with a closed one.

## Steps

1. Let the test peer record a close.
2. Send every row to a host of its own.
3. Hold an agreed row to its version, and an invalid row to `-32602`.
4. Hold a refused row to `-32005`, the protocol's baselines, and a closed connection.
5. List the rows the host answers otherwise as divergences.

## Validation

- `pnpm exec vitest run packages/sdk/test/ahp-test-cases.test.ts -t "version negotiation"` passes, with the host's departures named.

## Resume
