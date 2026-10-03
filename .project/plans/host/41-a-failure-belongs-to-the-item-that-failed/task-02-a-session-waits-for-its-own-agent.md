---
title: A session waits for its own agent
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L4134-L4148](../../../../packages/sdk/src/host.ts#L4134-L4148) - the listing's fallback to the first agent that listed a session"
  - "[code://packages/sdk/src/host.ts#L3586-L3594](../../../../packages/sdk/src/host.ts#L3586-L3594) - `keepProvider`"
---

## Objective

A session recorded for a provider this host is not serving is listed under that provider, opening or resuming it answers a sentence naming the agent that is not loaded, and nothing rewrites its record.

## Files

- `UPDATE: packages/sdk/src/host.ts:4134-4148` - when `kept.provider(id)` names a provider no loaded agent has, the row is answered under that provider's URI from the first lister's summary, not under the lister.
- `UPDATE: packages/sdk/src/host.ts` - every road that opens or resumes a session by URI refuses one whose provider is not loaded, with `<provider> is not loaded on this host`, before `keepProvider` can run.
- `UPDATE: packages/sdk/test/` (the session listing tests) - the cases below.

## Steps

1. Split the fallback: a recorded provider that is not loaded keeps its own name; a session with no record keeps today's first-lister fallback.
2. Find every caller of `keepProvider` and of the open path by URI (`rg -n "keepProvider|providerOf\\(" packages/sdk/src/host.ts`), and refuse there for a provider that is not loaded.
3. The refusal is an error answer to the client's request, not a stored message in the session.

## Validation

- Two agents `a` and `b` read one directory; a session recorded for `b` while only `a` is loaded is listed as `b:/<id>`, opening it is refused naming `b`, and `kept.provider(id)` is still `b`.
- With `b` loaded again, the same session opens on `b`.
- A session with no record still lists under `a`.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.

## Resume
