---
title: The host context exists, and which channel a URI means is one file
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L1155-L1207](../../../../packages/sdk/src/host.ts#L1155-L1207) - `heldAs`, `nameOf`, `ownName`"
  - "[code://packages/sdk/src/host.ts#L1540-L1648](../../../../packages/sdk/src/host.ts#L1540-L1648) - `sessionOfChat`, `sessionFor`, `chatOf`, `meantBy`"
  - "[code://packages/sdk/src/host.ts#L1810-L1985](../../../../packages/sdk/src/host.ts#L1810-L1985) - the spelling functions"
  - "[code://packages/sdk/src/host.ts#L2180-L2213](../../../../packages/sdk/src/host.ts#L2180-L2213) - `sessionHolding`, `channelKind`, `sessionChannel`, `homeOf`"
  - "[code://packages/sdk/src/host.ts#L7035-L7077](../../../../packages/sdk/src/host.ts#L7035-L7077) - `claimable`, `unheld`"
---

## Objective

`host/context.ts` declares `HostContext` and `ConnectionContext`, and `host/routing.ts` exports `createRouting(ctx: HostContext): Routing`, holding the functions below unchanged; `createHost` builds the context once and assigns the routing onto it.

## Files

- `CREATE: packages/sdk/src/host/context.ts` - types only: `HostContext` with `options`, the shared maps (`claims`, `agents`, `connections`, `presence`, `watches`, `kept`, `sessions`, `byChat`, `subagents`, `owners`, `names`, `terminals` and the rest), the funnel (`dispatch`, `broadcast`, `seenBy`, `refuse`), and the `Routing` fields; `ConnectionContext` with `connection` only for now.
- `CREATE: packages/sdk/src/host/routing.ts` - `Routing`, and `spaceHere`, `heldAs`, `nameOf`, `ownName`, `sessionOfChat`, `sessionFor`, `chatOf`, `meantBy`, `sessionHolding`, `channelKind`, `sessionChannel`, `homeOf`, `spelledFor`, `respell`, `respelledIn`, `spellingOf`, `answeredAs`, `claimable`, `unheld`.
- `UPDATE: packages/sdk/src/host.ts` - those functions removed; `const ctx = { options, claims, ... } as HostContext` once the maps and the funnel exist, then `Object.assign(ctx, createRouting(ctx))`; the names the closure still calls destructured from `ctx`.

## Steps

1. Write `host/context.ts` with every field documented by a one-line comment saying what it is; no function bodies.
2. Move each function with its comment into the factory body, unchanged but for indentation; the shared maps are taken off `ctx` at the top of the factory.
3. In `host.ts`, build the context after the shared maps and the funnel are declared, assign the routing onto it, and destructure the functions under their own names for the code that stays.
4. `waitingFor` is still in `host.ts`; it goes on the context, and `unheld` calls `ctx.waitingFor`.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass with no test changed; `test/subscribe.test.ts`, `test/session-provider.test.ts` and `test/uri-resources.test.ts` are the ones that exercise the spellings.
- `git diff -M --color-moved=zebra` shows the bodies as moved.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume
