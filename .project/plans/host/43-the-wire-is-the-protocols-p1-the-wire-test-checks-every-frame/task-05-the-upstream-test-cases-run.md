---
title: The protocol's own test cases run against ahpd, from the tag ahpd pins
status: todo
depends: []
layer: "sdk tests"
refs:
  - "https://github.com/microsoft/agent-host-protocol/tree/v1.0.0/types/test-cases - `reducers/` (308 files), `round-trips/` (63), `version-negotiation.json`"
  - npm://@microsoft/agent-host-protocol@1.0.0 - the version ahpd pins, and the reducers the cases are written for
---

## Objective

The protocol's test cases from tag `v1.0.0` run in `npx vitest run`.
A reducer case applies its actions to its initial state and compares the result with its expected state.
The cases for a state ahpd keeps also run through ahpd's own host.
The test dispatches the actions, subscribes on a fresh connection, and compares the snapshot.

## Files

- `CREATE: packages/sdk/test/fixtures/ahp-test-cases/` - the `types/test-cases` folder copied from tag `v1.0.0`, unchanged, with a `SOURCE.md` that names the tag and the commit.
- `CREATE: packages/sdk/test/ahp-test-cases.test.ts` - one test per case file.
- `CREATE: tools/ahp-test-cases.mjs` - copies the folder from a given tag, so the next protocol bump refreshes it in one command.

## Steps

1. Copy the cases from tag `v1.0.0`, the tag of the pinned package. Cases from a newer commit fail on actions this version does not have.
2. Run every reducer case through the package's own reducer. An explicit `null` and an absent key compare equal.
3. Run the root, session and chat cases through a host. Dispatch the actions on the channel, subscribe from a second connection, and compare the snapshot with the expected state.
4. Some cases describe a state ahpd never makes. List each of them by name in the test file, with the reason.
5. Run every round-trip case: parse, serialise, compare.
6. Run `version-negotiation.json` against ahpd's `initialize`.
7. Add a test that the package version in `package.json` and the tag in `SOURCE.md` agree.

## Validation

- `npx vitest run packages/sdk/test/ahp-test-cases.test.ts` passes, and the count of skipped cases equals the list in the file.
- A case changed by hand to a wrong expected state fails.
- `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass from the root.

## Resume
