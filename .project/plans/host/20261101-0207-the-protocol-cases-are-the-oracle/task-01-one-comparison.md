---
title: One comparison
status: todo
depends: []
layer: "sdk tests"
refs:
  - "[code://packages/sdk/test/ahp-test-cases.test.ts#L132-L155](../../../../packages/sdk/test/ahp-test-cases.test.ts#L132-L155) - `withoutNulls`, the reducer cases' rule"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts#L590-L601](../../../../packages/sdk/test/ahp-test-cases.test.ts#L590-L601) - `sameValue`, the host cases' rule"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/dotnet/tests/AgentHostProtocol.Tests/JsonCanon.cs#L10-L13 - the rule both become"
---

## Objective

Every comparison in the case driver reads a value the one way the protocol's conformance tests read it.

## Files

- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:1-28` - the file's opening says what each section checks and which rule it compares by.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:132-155` - `withoutNulls` becomes `canonical`, cited at the code.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:590-601` - `sameValue` goes; the host cases compare by `canonical`.

## Steps

1. Write `canonical` as JSON carries a value, with object members holding `null` dropped and list slots kept.
2. Cite `JsonCanon.cs` and its sentence above `canonical`.
3. Compare the reducer cases with `canonical`.
4. Rewrite the file's opening for what the reducer cases check: the installed package's reducers on the protocol's cases.

## Validation

- `pnpm exec vitest run packages/sdk/test/ahp-test-cases.test.ts -t "reducer cases"` passes all 308 cases.

## Resume
