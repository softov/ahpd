---
title: cofold finds a session by id
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L625-L640](../../../../packages/agent-cofold/src/agent.ts#L625-L640) - `list`, whose per-record mapping `find` shares"
  - "[code://packages/agent-cofold/src/agent.ts#L674-L678](../../../../packages/agent-cofold/src/agent.ts#L674-L678) - `transcript`, which already reads one record with `store.sessions.get`"
  - "[code://packages/agent-cofold/src/agent.ts#L107-L110](../../../../packages/agent-cofold/src/agent.ts#L107-L110) - `titleOf`"
  - "[code://packages/agent-cofold/test/agent-cofold-store.test.ts#L125](../../../../packages/agent-cofold/test/agent-cofold-store.test.ts#L125) - the listing test over a real file store, beside which the find tests go"
  - npm://@cofold/store-file@0.1.1 - `sessions.get({ sessionId })` finds the session folder on disk and reads its `session.json`
---

## Objective

cofold's agent answers `find(id)` with the row `list` would have answered for that session, reading that one record and its messages and never listing the store.

## Files

- `UPDATE: packages/agent-cofold/src/agent.ts:625-640` - `rowOf(record)`: the mapping `list` does per record (the first user input message for the title, `createdAt`, `updatedAt`, the workspace), taken out; `list` maps every record through it.
- `UPDATE: packages/agent-cofold/src/agent.ts` - `find: async (id) => { const record = await store.sessions.get({ sessionId: id }); return record === undefined ? undefined : await rowOf(record); }` after `list`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-store.test.ts` - the cases below.

## Steps

1. Take the per-record mapping out of `list` into `rowOf`, unchanged.
2. Add `find` over `store.sessions.get` and `rowOf`.
3. A session the store does not have is `undefined` from `sessions.get`, and any store error is raised, as `transcript` raises it; the host treats a throwing `find` as nothing to say.

## Validation

- In `agent-cofold-store.test.ts`, written first and failing because `find` is undefined:
  - a session created and torn down is answered by `find` with a row equal to the one `list()` answers for it, title and workspace included;
  - a session written to the store after a `list()` is found by `find`;
  - an id the store does not have answers `undefined`;
  - `find` does not call `store.sessions.list` (a spy on the store counts zero).
- `pnpm exec tsc --noEmit`, `pnpm test packages/agent-cofold`.

## Resume

- **Done:** implemented 2026-10-06, uncommitted. `recordRow` in `packages/agent-cofold/src/agent.ts` is the per-record mapping `list` and `find` share, `list` maps every record through it, and `find` reads one record with `store.sessions.get` and answers `undefined` for one the store does not have. `agent-cofold-store.test.ts` gains three cases and a `vi.mock` of `@cofold/store-file` that records every store made in the file, so a case can spy on the store the backend built for itself.
- **Gates:** `pnpm exec tsc --noEmit` passes; `pnpm exec vitest run packages/agent-cofold` passes, 15 files, 190 tests. The three new cases were seen failing first (30 tests, 3 failed) with `find` taken out of the agent.
- **Next action:** [task-03-acp-finds-a-session-by-listing-its-own-server.md](task-03-acp-finds-a-session-by-listing-its-own-server.md).
- **Open questions:** none.
- **Watch out for:** the plan names the extracted mapping `rowOf`, but `rowOf` is already this module's exported `ModelInfo` -> offered-model mapper (`agent.ts:317`), so the session mapping is `recordRow`; nothing else is renamed. `node tools/schema.mjs` has to have run before a bare `vitest run` in this package, or `agent-cofold-approval.test.ts` fails one case with ENOENT on `tools/ahp.strict.schema.json` - that is the workspace's generated schema, not this task. `createFakeModel`'s script is one step per model reply, so the new two-turn case scripts two steps.
