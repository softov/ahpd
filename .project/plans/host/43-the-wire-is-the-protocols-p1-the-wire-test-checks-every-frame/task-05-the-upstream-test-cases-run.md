---
title: The protocol's own test cases run against ahpd, from the tag ahpd pins
status: done
depends: []
layer: "sdk tests"
refs:
  - "https://github.com/microsoft/agent-host-protocol/tree/v1.0.0/types/test-cases - `reducers/` (308 files), `round-trips/` (67 cases), `version-negotiation.json` (22 rows)"
  - "code://packages/sdk/test/fixtures/ahp-test-cases/SOURCE.md - the tag and the commit the copy was taken from"
  - "code://packages/sdk/test/ahp-test-cases.test.ts - the cases, the two lists, and the census that checks them"
  - "code://packages/sdk/src/host/handshake.ts#L133-L153 - ahpd's `initialize`, which is where a negotiation row lands"
  - npm://@microsoft/agent-host-protocol@1.0.0 - the version ahpd pins, the reducers the cases are written for, and `IS_CLIENT_DISPATCHABLE`, which says which actions a client may send
---

## Objective

The protocol's test cases from tag `v1.0.0` run in `npx vitest run`.
A reducer case applies its actions to its initial state and compares the result with its expected state.
The cases for a state ahpd keeps also run through ahpd's own host.
The test dispatches the actions, subscribes on a fresh connection, and compares the snapshot.

## Files

- `CREATE: packages/sdk/test/fixtures/ahp-test-cases/` - the `types/test-cases` folder copied from tag `v1.0.0`, unchanged, with a `SOURCE.md` that names the tag and the commit.
- `CREATE: packages/sdk/test/ahp-test-cases.test.ts` - one test per case file, the two lists of cases that cannot be replayed, and the census that checks them.
- `CREATE: tools/ahp-test-cases.mjs` - copies the folder from a given tag, so the next protocol bump refreshes it in one command.

## Steps

1. Copy the cases from tag `v1.0.0`, the tag of the pinned package. Cases from a newer commit fail on actions this version does not have.
2. Run every reducer case through the package's own reducer. An explicit `null` and an absent key compare equal.
3. Run the root, session and chat cases through a host. Dispatch the actions on the channel, subscribe from a second connection, and compare the snapshot with the expected state.
4. Some cases describe a state ahpd never makes. List each of them by name in the test file, with the reason. A server-only action never reaches the state, so its case cannot run. For the rest, the host has no such state.
5. Run every round-trip case: parse, serialise, compare.
6. Run `version-negotiation.json` against ahpd's `initialize`.
7. Add a test that the package version in `package.json` and the tag in `SOURCE.md` agree.

## Validation

- `npx vitest run packages/sdk/test/ahp-test-cases.test.ts` passes, with 647 tests. The two lists in the file name exactly the cases the test cannot replay.
- A case changed by hand to a wrong expected state fails.
- `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass from the root.

## Resume

Built. `packages/sdk/test/ahp-test-cases.test.ts` runs 647 tests in 4 seconds. 308 reducer cases go through the package's own reducers. 67 round-trip cases and 22 negotiation rows go through the JSON round trip and ahpd's `initialize`. The 248 root, session and chat cases each get a host of their own.

Of those 248, 29 run and are compared. 205 are refused, and each is named. 146 are refused because a client may not send what they name. The test checks that against `IS_CLIENT_DISPATCHABLE`, case by case. 59 name actions a client may send, and the host refuses those because it has no such state. The file groups them under the reason the host gave. 14 more run and answer differently on a field the host owns, each named with the field.

Nothing is skipped. A case that cannot be replayed is asserted to be refused, and the test checks both lists by length and by membership in both directions. `tools/ahp-test-cases.mjs` takes a fresh copy from a checkout of the protocol repository; it was not run here, because nothing in this session fetches.
