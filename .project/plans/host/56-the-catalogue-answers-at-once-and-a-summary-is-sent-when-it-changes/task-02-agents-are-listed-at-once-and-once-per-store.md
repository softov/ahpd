---
title: Agents are listed at once, and Claude's variants read their store once
status: done
depends: []
layer: "sdk, agent-claude"
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L289-L315](../../../../packages/sdk/src/host/catalogue.ts#L289-L315) - the loop that awaits each agent's `list` in turn"
  - "[code://packages/agent-claude/src/plugin.ts#L189-L211](../../../../packages/agent-claude/src/plugin.ts#L189-L211) - `optionsOf` and `apply`, where the shared listing is built"
  - "[code://packages/agent-claude/src/claude.ts#L411](../../../../packages/agent-claude/src/claude.ts#L411) - `list`, which takes it"
  - "[code://packages/agent-claude/src/catalog.ts#L23-L32](../../../../packages/agent-claude/src/catalog.ts#L23-L32) - `catalogue`, the one SDK call per path"
  - "[code://packages/sdk/test/support/claude-sdk.ts](../../../../packages/sdk/test/support/claude-sdk.ts) - the fake `listSessions`, which gains a call count"
---

## Objective

A listing asks every agent at the same time, and the Claude variants of one load read the projects directory once between them, per the decision [Claude variants share one listing inside the plugin](../../../decisions/claude-variants-share-one-listing-inside-the-plugin.md).

## Files

- `UPDATE: packages/sdk/src/host/catalogue.ts:289-315` - the agents are asked with one `Promise.all`, then folded in load order.
- `UPDATE: packages/agent-claude/src/catalog.ts` - `sharedCatalogue(dirs)`: a function that lists every path and hands a caller the listing already running, if one is.
- `UPDATE: packages/agent-claude/src/plugin.ts:189-211` - one `sharedCatalogue(paths)` per load, passed to every variant.
- `UPDATE: packages/agent-claude/src/claude.ts:411` - `list` uses the shared listing when it is given one, and `catalogue` per path when it is not.
- `UPDATE: packages/sdk/test/support/claude-sdk.ts` - `sdk.listed`, a count of `listSessions` calls, and a tick before it answers so callers overlap.
- `CREATE: packages/sdk/test/host-catalogue-parallel.test.ts`.
- `CREATE: packages/agent-claude/test/agent-claude-shared-listing.test.ts`.

## Steps

1. In `listing`, map `agents.values()` that have `list` to `agent.list().catch(...)` and await them together; keep `answered`, `refused`, `spoken` and `read` as they are counted today.
2. Fold the answers into `offered` in the order of `agents.values()`, not the order they resolved, so `both[0]` is the first-loaded agent as before.
3. In `catalog.ts`, `sharedCatalogue(dirs)` keeps the promise of the listing in flight and drops it when it settles; it caches nothing after that, because the host holds the catalogue (task 03).
4. In `optionsOf`, build one per load and put it in `shared`; add the optional field to `ClaudeOptions` with a comment that every variant of one load lists the same `paths`.
5. `list` in `claude.ts` returns the shared listing's rows; each call gets its own copy of the array, because the host's fold does not mutate rows but a variant should not hand out another's array.

## Validation

- `host-catalogue-parallel.test.ts`: three fake agents whose `list` waits 50 ms and counts how many are running at once; one `listSessions` sees all three running together, and takes about 50 ms rather than 150 ms; an id two agents list goes to the first-loaded one when nothing is recorded, and to the recorded one when it is.
- `agent-claude-shared-listing.test.ts`: the plugin applied with three presets; listing all three agents at once calls the fake `listSessions` once per path; each agent answers the same rows; a second listing after the first settled calls it again.
- `pnpm exec tsc --noEmit`, `pnpm test`.

## Resume

Implemented 2026-10-04.

- `listing` maps every agent that has a `list` to a promise and awaits them with one `Promise.all`. `Promise.all` answers in the order it was given its work, so the fold below is still the load order and `both[0]` is still the first-loaded agent; that is said in the comment beside it because the property is invisible in the code and load-bearing for which row an id is.
- `sharedCatalogue(dirs)` in `packages/agent-claude/src/catalog.ts`, imported as `oneListing` in `plugin.ts`, built once per `optionsOf` call and handed to every variant through the new optional `ClaudeOptions.sharedCatalogue`. `list` uses it when given and reads `dirs` itself when not, and copies the shared array per call.
- `sdk.listed` and a tick before `listSessions` answers, in the fake SDK. Nothing in `packages/sdk/test` reads `sdk.listed` yet; task 03's held-catalogue test is where it pays, and the agent-claude test counts its own.

Departures from the plan:

- The plan's second case for the fold - "to the recorded one when it is [recorded]" - is not in `host-catalogue-parallel.test.ts`. It is not reachable there: within one process `kept.provider(id)` can only name a backend that already owns the row, so a host cannot be made to record a second backend for an id without a session store. `session-provider.test.ts` already covers that choice against a real store (`goes to the harness the host recorded, whichever one loaded first`), and it is what would catch a fold-order break, so it is left where it is.
- `host-catalogue-parallel.test.ts` builds its own host rather than going through `support/host.ts`, because `serving()` registers one agent and these tests need three.

Gates: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (204 files, 2851 tests) all pass.
