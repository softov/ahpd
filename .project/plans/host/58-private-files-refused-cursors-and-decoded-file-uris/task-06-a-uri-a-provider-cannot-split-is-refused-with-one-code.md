---
title: A URI a provider cannot split is refused with one code
status: todo
depends: []
layer: "sdk, computer"
refs:
  - "[code://packages/sdk/src/policy.ts#L43-L49](../../../../packages/sdk/src/policy.ts#L43-L49) - `splitFor`, `-32609`"
  - "[code://packages/sdk/src/people.ts#L312-L318](../../../../packages/sdk/src/people.ts#L312-L318) - people's `split`, `-32609`"
  - "[code://packages/sdk/src/usage.ts#L394-L397](../../../../packages/sdk/src/usage.ts#L394-L397) - usage's `at`, `-32009`"
  - "[code://packages/computer/src/provider.ts#L118-L122](../../../../packages/computer/src/provider.ts#L118-L122) - computer's `at`, `-32009`"
  - "[code://packages/sdk/src/host/resourcemethods.ts#L52-L58](../../../../packages/sdk/src/host/resourcemethods.ts#L52-L58) - routing by lowercased scheme, so only a malformed URI of a provider's own scheme reaches `split`"
  - "[code://packages/sdk/test/people.test.ts#L72](../../../../packages/sdk/test/people.test.ts#L72) - pins `-32609`"
  - "[code://packages/sdk/test/policy-scheme.test.ts#L169-L173](../../../../packages/sdk/test/policy-scheme.test.ts#L169-L173) - pins `-32609`"
  - "[code://packages/sdk/test/usage-scheme.test.ts#L285-L288](../../../../packages/sdk/test/usage-scheme.test.ts#L285-L288) - pins `-32009`"
  - npm://@microsoft/agent-host-protocol@1.0.0 - `JsonRpcErrorCodes.InvalidParams` is `-32602`; no `-32609` exists; `-32009` is `PermissionDenied`
---

## Objective

People, policy, usage and computer each refuse a URI they cannot split with `-32602`, and the sentence each says today stays as it is.

## Files

- `UPDATE: packages/sdk/src/policy.ts:45` - `-32609` becomes `-32602`.
- `UPDATE: packages/sdk/src/people.ts:314` - the same.
- `UPDATE: packages/sdk/src/usage.ts:395` - `-32009` becomes `-32602`.
- `UPDATE: packages/computer/src/provider.ts:120` - the same.
- `UPDATE: packages/sdk/test/people.test.ts:72`, `packages/sdk/test/policy-scheme.test.ts:171-172`, `packages/sdk/test/usage-scheme.test.ts:288` - the pinned code.
- `UPDATE: packages/computer/test/computer.test.ts` - a new case.
- `UPDATE: packages/sdk/test/policy-scheme.test.ts` - a host-level case.

## Steps

1. Change the four codes; the plan's second table records the source and the open question on `-32601`.
2. Change no sentence, so a client reading the message reads what it read before.

## Validation

- Written first and seen failing: the three pinned tests changed to `-32602` fail before the code moves; a new `computer.test.ts` case, `computerProvider(...).read('usage://x')`, fails with `-32009`.
- Written first and seen failing: through a host with the policy provider, `resourceRead` of `policy:M1` (no `//`) answers `-32602`.
- `pnpm exec tsc --noEmit`, `pnpm test packages/sdk packages/computer`.

## Resume
