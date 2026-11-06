---
title: The store keeps the automation origin
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/sessions/sessions.ts#L138-L141](../../../../packages/sdk/src/sessions/sessions.ts#L138-L141) - the `createdBy` getter and setter to copy"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1822](../../../../packages/sdk/src/host/lifecycle.ts#L1822) - where a new session's origin is set"
---

## Objective

A session's automation origin is in the store as well as in `origins`.
After a restart, the summary of that session names the automation and the run.

## Files

- `UPDATE: packages/sdk/src/types/sessions.ts:374-409` - add optional `automationOrigin(id)` and `setAutomationOrigin(id, value)` to the store.
- `UPDATE: packages/sdk/src/sessions/sessions.ts` - keep `automationOrigin` on the row, write it, and read it back at start as `createdBy` is.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:1822` - write the origin to the store where `origins` gets it.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:404-416` - clear the stored origin where `origins` loses it.
- `UPDATE: packages/sdk/src/host/automations.ts:930` - write the origin to the store as well.
- `UPDATE: packages/sdk/src/host/catalogue.ts` - read a stored origin for a session that `origins` does not hold.
- `CREATE: packages/sdk/test/host-automation-origin.test.ts` - the origin outlives a host that closes and opens on the same store.

## Steps

1. Add the getter and the setter to the store type, each optional, with a one-line comment.
2. Keep `automationOrigin` on the stored row, and write it with the row.
3. Read it back at start with a reader that accepts only `{ kind: 'automation', automation, run }` strings.
4. Write the origin to the store at each `origins.set` call.
5. Clear it in the store at each `origins.delete` call.
6. Fill `origins` from the store for a session that it does not hold, before a summary reads it.
7. Write a test: make a session with an automation origin, close the host, and open a host on that store.
8. Assert that the summary of that session names the automation and the run.

## Validation

- `packages/sdk/test/host-automation-origin.test.ts` passes.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass, and the sdk tests pass.

## Resume

- **Done so far:** the store keeps `automationOrigin` on a session row, writes it, and reads it back at start.
The host writes it where `origins` gets an origin and clears it where a disposed session loses one.
The catalogue reads the store for a session `origins` does not hold.
- **Next action:** [task-02-a-turn-keeps-its-origin.md](task-02-a-turn-keeps-its-origin.md).
- **Open questions:** none.
- **Watch out for:** the failed-open path at [code://packages/sdk/src/host/lifecycle.ts#L1865](../../../../packages/sdk/src/host/lifecycle.ts#L1865) clears `origins` and then forgets the whole row.
The stored origin goes with it, so no second clear is needed.

Files changed by this task: `packages/sdk/src/index.ts`, `packages/sdk/src/types/sessions.ts`, `packages/sdk/src/sessions/sessions.ts`, `packages/sdk/src/host/lifecycle.ts`, `packages/sdk/src/host/automations.ts`, `packages/sdk/src/host/catalogue.ts`, `packages/sdk/test/host-automation-origin.test.ts`.

