---
title: Request params are read one way, and -32602 has a name
status: done
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

- **Implemented** 2026-10-10 on `build/agents/5a3a4ac2`, reviewed and done 2026-10-10.
- `packages/sdk/src/rpc.ts` names `INVALID_PARAMS`, the protocol's `-32602`, beside the four codes already there.
- The same file holds the three request-param readers: `stringParam`, `optionalStringParam` and `numberParam`, each `(params, key, what)`.
- Each reader refuses with `INVALID_PARAMS` and the sentence its caller passes as `what`, so every refusal says what it said before.
- No raw `-32602` is left in `packages/sdk/src`: 78 sites over 19 files now name `INVALID_PARAMS` (the task file's 65 was counted on 2026-10-05).
- `packages/sdk/src/host/vscodemethods.ts` has one `connectionIdOf(params)` where two `connectionId` checks stood.
- Its `String(params.x ?? '')` reads stay as they are, because they accept any value rather than refusing one.
- Its `typeof params.x !== 'string'` refusals read through the helpers, and `data must be a string` is one of them.
- The sentences are unchanged: `session must be a URI string`, `chat must be a URI string`, `prompt must be a string`, `url must be a string`, `resource must be a URI string`, `position must be a number`, and the two `connectionId` refusals.
- `packages/sdk/test/rpc.test.ts` has 8 new cases over the three readers: the value each answers, and the code and sentence each refuses with.
- Agent packages keep their raw `-32602`; they can take the name once they import anything else from `rpc.ts`.
- Gates: `pnpm install`, `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck`, `pnpm boundary` and the full suite pass, 4816 tests over 269 files.
