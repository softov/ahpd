---
title: Request params are read one way, and -32602 has a name
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/rpc.ts#L13-L16](../../../../packages/sdk/src/rpc.ts#L13-L16) - the named codes"
  - "[code://packages/sdk/src/host/vscodemethods.ts#L102-L130](../../../../packages/sdk/src/host/vscodemethods.ts#L102-L130) - `connectionId` checked twice"
  - "[code://packages/sdk/src/host/vscodemethods.ts#L143-L310](../../../../packages/sdk/src/host/vscodemethods.ts#L143-L310) - the run of string and number refusals"
  - "[code://packages/sdk/src/host/resourcemethods.ts](../../../../packages/sdk/src/host/resourcemethods.ts) - 15 `String(params.x ?? '')` reads"
  - "[code://packages/sdk/src/host/sessionmethods.ts](../../../../packages/sdk/src/host/sessionmethods.ts) - 13 more"
---

## Objective

`rpc.ts` names `INVALID_PARAMS`, every `new RpcError(-32602, ...)` in `packages/sdk/src` uses it, and a request param that must be a string or a number is read by one helper that refuses with today's sentence.

## Files

- `UPDATE: packages/sdk/src/rpc.ts:13-16` - `export const INVALID_PARAMS = -32602;` and `stringParam(params, key, what = 'a string')`, `optionalStringParam`, `numberParam`, each refusing `${key} must be ${what}` with `INVALID_PARAMS`.
- `UPDATE: packages/sdk/src/host/vscodemethods.ts:102-130` - one `connectionIdOf(params)` for both checks.
- `UPDATE: packages/sdk/src/host/vscodemethods.ts:143-310` - the `typeof params.x !== 'string'` refusals through the readers, `what` passed where the sentence says `a URI string`.
- `UPDATE: packages/sdk/src/**/*.ts` - the 65 raw `-32602` become `INVALID_PARAMS`.
- `UPDATE: packages/sdk/test/rpc.test.ts` - the helper's cases.

## Steps

1. Leave the `String(params.x ?? '')` reads that accept any value, which are not refusals; move only those beside a refusal.
2. Agent packages keep their raw codes; they can take the name once they import anything else from `rpc.ts`.

## Validation

- `rpc.test.ts`, a new helper's cases: each reader's accepted value, its refusal code and its sentence.
- A pure refactor: every `packages/sdk` test stays green unchanged, the sentences included.
- `rg -n "RpcError\(-32602" packages/sdk/src` finds nothing.
- `pnpm exec tsc --noEmit`, `pnpm test packages/sdk`.

## Resume
