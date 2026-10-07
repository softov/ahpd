---
title: The wire test checks every request, result and notification against the protocol - implemented
date: 2026-10-07
refs:
  - "[code://packages/sdk/test/wire.test.ts](../../../../packages/sdk/test/wire.test.ts) - the recorded host, the two lists, and the census over every `_meta` key"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts) - the protocol's own cases, its two refusal lists and the host-owned field map"
  - "[code://packages/sdk/test/fixtures/ahp-test-cases/SOURCE.md](../../../../packages/sdk/test/fixtures/ahp-test-cases/SOURCE.md) - the tag and the commit the case copy came from"
  - "[code://tools/wire.mjs](../../../../tools/wire.mjs) - `frame()` routes by the protocol's four maps, and `metaKeys` is the census beside it"
  - "[code://tools/schema.mjs](../../../../tools/schema.mjs) - one definition per `Partial<T>`, and the bit flags of `SessionStatus`"
  - "[code://tools/ahp-test-cases.mjs](../../../../tools/ahp-test-cases.mjs) - the refresh of the case copy from a given tag"
---

A wire test that checked snapshots and actions now checks every frame ahpd sends. Request params and results go by `CommandMap`, and notifications by `ServerNotificationMap`. Every `_meta` key is checked by name. The protocol's own cases from tag `v1.0.0` run against the package's reducers, its round trips, its negotiation rows, and a live host.

## What was built

- [`code://tools/schema.mjs`](../../../../tools/schema.mjs) - `nameOf` names a generic alias by its alias and its type arguments. `Partial<SessionSummary>` and `Partial<ChatSummary>` then become two definitions instead of one shared `Partial`. A numeric enum whose members are bit flags is emitted as the enum of every OR of its members. That is how `SessionStatus` and `SessionChatSummary.status` are checked.
- [`code://tools/wire.mjs`](../../../../tools/wire.mjs) - `frame()` takes a recorded exchange and a notification beside the frames it took before. It routes each by `CommandMap`, `ServerCommandMap`, `ServerNotificationMap` or `ClientNotificationMap`. A declared `null` is checked as `{ type: 'null' }`. A method in no map is reported through `skipped()`. `metaKeys(frame)` answers each `_meta` key with the path it was found at.
- [`code://packages/sdk/src/rpc.ts`](../../../../packages/sdk/src/rpc.ts) - the response frame's `result` comes from one exported function, `resultFrame`, so the test records what the wire carries and not what the handler returned.
- [`code://packages/sdk/src/host/facts.ts`](../../../../packages/sdk/src/host/facts.ts) - `describes` composes the backend's `_meta` with the host's, the host's keys winning a collision. A backend key such as `model` then survives on the state and on the row.
- [`code://packages/sdk/test/wire.test.ts`](../../../../packages/sdk/test/wire.test.ts) - the traffic runs over a host with a users directory, a signed-in person on a team, and an owned automation with runs. The host also holds a skill with an argument hint, an echo session, and the daemon's root config with a plugin's options. `KNOWN` holds today's findings, each with the plan that removes it. `REFERENCE` and `PENDING` judge every `_meta` key by the place it was found.
- [`code://packages/sdk/test/ahp-test-cases.test.ts`](../../../../packages/sdk/test/ahp-test-cases.test.ts) - one test per case file. The 308 reducer cases go through the package's own reducers. The 67 round-trip cases go through parse and serialise. The 22 negotiation rows go through ahpd's `initialize`. Each of the 248 root, session and chat cases gets a host of its own.
- [`code://packages/sdk/test/fixtures/ahp-test-cases/`](../../../../packages/sdk/test/fixtures/ahp-test-cases/) - the `types/test-cases` folder of tag `v1.0.0`, unchanged, with a `SOURCE.md` naming the source repository, the tag and the commit.
- [`code://tools/ahp-test-cases.mjs`](../../../../tools/ahp-test-cases.mjs) - takes a fresh copy from a checkout of the protocol repository at a given tag. It refuses when the tag and the installed package disagree, and regenerates `SOURCE.md`.
- [`code://packages/sdk/test/support/wire.ts`](../../../../packages/sdk/test/support/wire.ts) - `undeclaredIn`, the protocol's check over a host's frames minus the one departure this host keeps.
- [`code://packages/agent-claude/test/agent-claude-usage.test.ts`](../../../../packages/agent-claude/test/agent-claude-usage.test.ts) and [`code://packages/sdk/test/commit.test.ts`](../../../../packages/sdk/test/commit.test.ts) - the same `metaKeys` census over what a turn's usage and a changeset row emit.

## Verified

- `packages/sdk/test/ahp-test-cases.test.ts`: 647 tests. 308 reducer cases, 67 round trips and 22 negotiation rows run. Of the 248 root, session and chat cases, 29 match, 14 differ only on a field the host owns, and 205 are refused. 146 of those are refused because `IS_CLIENT_DISPATCHABLE` says a client may not send the action, and the test checks that case by case. The other 59 name actions a client may send, and the file groups them under the host's own reason.
- `packages/sdk/test/wire.test.ts`: 236 payloads checked against 508 declarations, the findings equal to `KNOWN` exactly, and one deliberate departure in `refused`.
- `npx vitest run` from the root: 240 files, 4203 tests pass. `pnpm build`, `pnpm typecheck` and `pnpm boundary` are clean; every package reports "declared, none undeclared".
- One run of the full suite failed `packages/sdk/test/host-catalogue.test.ts` at `rowsMoved(p, 'claude:/old')` with a length of 0 against 1. That file passed on its own, and the immediate re-run of the full suite passed every file. The test is untouched by this plan.
- `node tools/schema.mjs` prints `PartialSessionSummary` and `PartialChatSummary` and no `Partial`.

## Departures from the plan

- The plan's Validation said the count of skipped cases equals the list in the file. Nothing is skipped. A case ahpd cannot replay is asserted to be refused and named. The test checks both lists by length and by membership in both directions, so a case that changes side fails either way.
- The plan named two outcomes for a host case, compared or listed. The build found a third: 14 cases run and answer differently on a field the host owns. The fields include `activeTurn`, `turns`, `activeClients`, `status`, `agents` and `config`. `HOST_OWNS` names that field for each case. The difference is stated, not hidden in a skip.
- Task 03 needed `model` in a row's `_meta` while `describes` replaced `_meta` whole and erased it. The builder chose that `describes` compose the backend's map with the host's, as a fix. It was not asked, and Softov may reverse it. That row is in the plan's Decisions table.
- An explicit `null` and an absent key compare equal in a reducer case, because this host omits a field the fixtures write as `null`. This is the plan's Decisions row, implemented as `withoutNulls` on both sides.
- `tools/ahp-test-cases.mjs` was written but not run: the copy came from the checkout Softov made, and nothing in this session fetches.
- No commit was made, so this file carries no `git://` ref; the work is the working tree of `build/agents/238e6e3f`.

## Left for later

- The `KNOWN` list in `packages/sdk/test/wire.test.ts` and the `PENDING` list of unprefixed `_meta` keys both stand until p2, p3 and p4 empty them. Every line names the plan that removes it.
- `getNetworkDiagnosticsInfo`, `getManagedSettingsDiagnostics`, `diagnosticsFetch`, the `vscode/*` requests and the `vscode/devContainers/*` notifications stay, as deliberate departures, each with the `docs/AHP.md` heading that records it.
