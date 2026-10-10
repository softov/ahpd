---
title: Sessions and names are files of their own, and users-gate.test.ts is gone
status: done
depends: [task-02-the-command-and-dispatch-gates.md]
layer: "sdk test"
refs:
  - "[code://packages/sdk/test/users-gate.test.ts#L992-L1244](../../../../packages/sdk/test/users-gate.test.ts#L992-L1244) - sessions held under a provider's scheme, their changesets and the rows a backend keeps on disk"
  - "[code://packages/sdk/test/users-gate.test.ts#L1469-L1481](../../../../packages/sdk/test/users-gate.test.ts#L1469-L1481) - `asks a session's grants for completions in a session`, which sits in the names block and goes with the sessions"
  - "[code://packages/sdk/test/users-gate.test.ts#L1703-L1786](../../../../packages/sdk/test/users-gate.test.ts#L1703-L1786) - `computer:write` for a session's source and for an automation's owner"
  - "[code://packages/sdk/test/users-gate.test.ts#L1246-L1467](../../../../packages/sdk/test/users-gate.test.ts#L1246-L1467) - `publishing` and the names block"
  - "[code://packages/sdk/test/users-gate.test.ts#L1483-L1701](../../../../packages/sdk/test/users-gate.test.ts#L1483-L1701) - `answering` and the client id block"
---

## Objective

`packages/sdk/test/users-gate-sessions.test.ts` holds the 13 tests of what a session's grants cover, and `packages/sdk/test/users-gate-names.test.ts` holds the 16 tests of names, spellings, relayed watches and client ids.
`packages/sdk/test/users-gate.test.ts` is empty after the move and is deleted.
Line numbers below are today's; after tasks 01 and 02 find each block by its test title or helper name.

## Files

- `CREATE: packages/sdk/test/users-gate-sessions.test.ts` - about 320 lines: 992-1022, 1039-1120, 1148-1244, 1469-1481 and 1703-1786, 13 tests.
- `CREATE: packages/sdk/test/users-gate-names.test.ts` - about 455 lines: 1246-1467 and 1483-1701 without 1469-1481, 16 tests.
- `DELETE: packages/sdk/test/users-gate.test.ts` - every test and helper in it has moved.

## Steps

1. Record the test count as in task 01, step 1.
2. Write `users-gate-sessions.test.ts` in this order: `reads a session held under its provider's scheme as a session, and a file as a file` (992-1022); the three tests from `needs a session's write group to drive one, and the act it is refused is the one it did` to `needs session:changes as well as file:write to run an operation on a session's changeset, under either name` (1039-1120); the six tests from `asks a session's grants for a row a backend keeps on disk, under its name or any other` to `keeps config for a channel that names no session out of the store` (1148-1244); `asks a session's grants for completions in a session` (1469-1481); `needs computer:write to name a source for a session, and no more to name a machine` and `asks an automation's owner for computer:write, and refuses a run it cannot check` (1703-1786).
3. Its imports are `expect`, `it`, `vi`, `ROOT`, `uriOf`, `memorySessions`, `memoryAutomations`, `echo`, `import type` for `ChangesetSource` and `Owner`, and from `./users-gate-helpers.js` `root`, `file`, `peer`, `directory`, `host`, `hello`, `signIn`, `call`, `withRole`, `onDisk` and `listingOne`.
4. Write `users-gate-names.test.ts` in this order: `publishing` with its doc comment and the nine tests from `reads a session spelt as a file or as a watch as what it is spelt as` to `keeps a session's marks out of a file named after it` (1246-1467); `answering` with its doc comment and the seven tests from `resumes another person's client id with nothing it may not read, and no claim on it until they sign in` to `routes nothing to a person removed while connected, and binds no id to a connection without one` (1483-1701).
5. Its imports are `expect`, `it`, `ROOT`, `memorySessions`, `memoryAutomations`, `shellTerminals`, `echo`, `import type` for `Peer`, and from `./users-gate-helpers.js` `RECORD`, `root`, `peer`, `watching`, `Bag`, `until`, `directory`, `host`, `hello`, `signIn`, `call`, `withRole` and `listingOne`.
6. Check `users-gate.test.ts` holds nothing but imports, then delete it.

## Validation

- `users-gate-sessions.test.ts` holds 13 tests and `users-gate-names.test.ts` holds 16, each title unchanged.
- Every test title of `users-gate.test.ts` at `b4f1a4b` appears exactly once across `packages/sdk/test/users-gate-*.test.ts`.
- `wc -l packages/sdk/test/users-gate-*.ts` is under 800 for every file.
- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/sdk` passes.
- The test count in `packages/sdk` equals the count recorded in step 1 and the count recorded before task 01, and `pnpm exec vitest list packages/sdk/test/users-gate | wc -l` is 60.

## Resume

Done. `users-gate-sessions.test.ts` is 322 lines with 13 tests and `users-gate-names.test.ts` is 453 lines with 16 tests, and `users-gate.test.ts` is deleted. `users-gate.test.ts` held nothing but the 29 moved tests before it went, so nothing was left behind.
The multiset of every non-blank, non-import line of the old file at `b4f1a4b` hashes the same as the union of the six new files' once `export ` is stripped and the eight import-continuation lines are taken out, and the multiset of the 60 `it(` lines hashes the same, so the move dropped nothing and rewrote nothing.
`wc -l packages/sdk/test/users-gate-*.ts` is under 800 for every file. `vitest list packages/sdk/test/users-gate` is 60 and `vitest run packages/sdk` is green, `tsc --noEmit` and `pnpm boundary` pass.

Nothing left to do; `plans/index.md` was left alone, as the plan's decisions ask.
