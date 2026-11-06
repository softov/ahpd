---
title: A listed row carries _meta
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L128-L138](../../../../packages/sdk/src/types/agent.ts#L128-L138) - `Listed`"
  - "[code://packages/sdk/src/host/catalogue.ts#L1000-L1026](../../../../packages/sdk/src/host/catalogue.ts#L1000-L1026) - `adopt`, which keeps `births` and `moves` for each row"
  - "[code://packages/sdk/src/host/facts.ts#L190-L202](../../../../packages/sdk/src/host/facts.ts#L190-L202) - `agentMeta`"
  - "[code://packages/sdk/test/host-catalogue.test.ts](../../../../packages/sdk/test/host-catalogue.test.ts) - the listing tests"
  - "[code://packages/sdk/test/host-snapshots.test.ts](../../../../packages/sdk/test/host-snapshots.test.ts) - the browsed state tests"
---

## Objective

A backend can say what a session's `_meta` holds while nothing runs it.
The host sends that `_meta` on the summary and on the browsed state.

## Files

- `UPDATE: packages/sdk/src/types/agent.ts:128-138` - add an optional `_meta` to `Listed`, with a comment that says what it is.
- `UPDATE: packages/sdk/src/host/context.ts` - the `listedMeta` field the catalogue writes and `facts` reads.
- `UPDATE: packages/sdk/src/host.ts` - the map itself, and its entry in the context literal.
- `UPDATE: packages/sdk/src/host/catalogue.ts:1000-1026` - keep `row._meta` for the resource in `adopt`, and give the host a way to read it.
- `UPDATE: packages/sdk/src/host/facts.ts:190-202` - make `agentMeta` answer the kept `_meta` when no agent runs the session.
- `UPDATE: packages/sdk/test/host-catalogue.test.ts` - the summary cases below.
- `UPDATE: packages/sdk/test/host-snapshots.test.ts` - the browsed state cases below.

## Steps

1. Add `_meta?: Record<string, unknown>` to `Listed`.
2. Keep `row._meta` by resource in `adopt`, beside `births` and `moves`.
3. Replace the kept value each time `adopt` sees the row again, and remove it when the row has no `_meta`.
4. Make `agentMeta` return the kept value when the session has no running lead.
5. Keep the running lead's `_meta` first when the session runs.
6. Update the comment on `agentMeta`, because it is no longer empty for every session that is not running.
7. Run `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`, then restore `packages/sdk/test/fixtures/wire.jsonl`.

## Validation

- A test lists a row with `_meta`, and the summary's `_meta` holds those keys.
- A test opens that row with nothing running, and the browsed state's `_meta` holds those keys.
- A test finds a row by `find` with `_meta`, and the summary holds those keys.
- A test starts the session, and the state's `_meta` holds the running agent's keys and not the listed ones.
- A test lists a row with a key that the host also sets, and the host's value wins.

## Resume

- **Done so far:** every step is in. `Listed` has an optional `_meta`; `adopt` keeps it per resource in `listedMeta`; and `agentMeta` answers it when no lead runs.
- **Next action:** none, this task is implemented.
- **Files:** `packages/sdk/src/types/agent.ts`, `packages/sdk/src/host/context.ts`, `packages/sdk/src/host.ts`, `packages/sdk/src/host/catalogue.ts`, `packages/sdk/src/host/facts.ts`, `packages/sdk/test/host-catalogue.test.ts`, `packages/sdk/test/host-snapshots.test.ts`.
- **Open questions:** none.
- **Departures:** the browsed-state case resumes the row with `chat/turnStarted`, because `createSession` refuses an id that is already listed (-32003).
- **Watch out for:** `describes` spreads the agent's map first, so a host key wins a collision by construction. Keep that order, and keep the listed map replaced rather than merged.
