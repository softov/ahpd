---
title: Results and actions are the protocol's shapes - implemented
date: 2026-10-07
refs:
  - "[code://packages/sdk/src/rpc.ts#L183](../../../../packages/sdk/src/rpc.ts#L183) - `resultFrame`, which sends a handler's `null` as `null` and its nothing as `{}`"
  - "[code://packages/sdk/src/automations.ts#L62-L90](../../../../packages/sdk/src/automations.ts#L62-L90) - `shown()`, which is how many runs of an automation a client has been shown"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L300-L314](../../../../packages/sdk/src/host/sessionconfig.ts#L300-L314) - `published()`, which sets `type: 'object'` on every schema a backend publishes"
  - "[code://docs/AHP.md#L773-L806](../../../../docs/AHP.md#L773-L806) - the departures, and the table naming them"
---

Every request this host answers now carries the result the protocol declares for it, `null` where it says `null`. An older page of an automation's runs arrives where the protocol says it does, on the entry rather than in the answer. A session's state and its config schema carry only keys the protocol declares. `docs/AHP.md` names everything served outside AHP 1.0.0, and the wire test reads that table back.

## What was built

- [`code://packages/sdk/src/rpc.ts`](../../../../packages/sdk/src/rpc.ts) - `resultFrame` passes a handler's `null` through, and still answers `{}` for a handler that returned nothing.
- [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts), [`code://packages/sdk/src/host/terminals.ts`](../../../../packages/sdk/src/host/terminals.ts) and [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - `ping`, `createTerminal`, `disposeTerminal`, `createSession`, `createChat`, `disposeChat` and `disposeSession` answer `null`, which is `{"type":"null"}` in the installed package's `CommandMap`.
- [`code://packages/sdk/src/automations.ts`](../../../../packages/sdk/src/automations.ts) - the store keeps how many runs each automation shows, starting at one page. `entry()` carries that many runs and `runsNextCursor` when more exist, and `runs()` advances the count and announces the automation. A cursor the store did not issue is refused.
- [`code://packages/sdk/src/host/automations.ts`](../../../../packages/sdk/src/host/automations.ts) - `fetchAutomationRuns` answers `{}`, which is `FetchAutomationRunsResult`, and refuses an unrecognised cursor `-32602`.
- [`code://packages/agent-claude/src/session/asking.ts`](../../../../packages/agent-claude/src/session/asking.ts) and [`code://examples/notes/agent.ts`](../../../../examples/notes/agent.ts) - `chat/inputRequested` is `type` and `request`, with no `turnId`.
- [`code://packages/sdk/src/host/sessionconfig.ts`](../../../../packages/sdk/src/host/sessionconfig.ts) - `published()` sets `type: 'object'`, which covers the resolved schema and the schema a session state carries.
- [`code://packages/sdk/src/host/snapshots.ts`](../../../../packages/sdk/src/host/snapshots.ts) and the four backends - a session state carries no `resource`. The host takes it off the backend's answer, and echo, notes, acp and cofold stop sending it.
- [`code://docs/AHP.md`](../../../../docs/AHP.md) - a new section names all twenty-two departures in a table. It is headed "What is served outside the protocol", and each row says why the entry stays and links to where it is described.
- [`code://packages/sdk/test/wire.test.ts`](../../../../packages/sdk/test/wire.test.ts) - `DEPARTURES` holds those twenty-two, and the test reads the section's table back and compares the two as sets.

## Verified

- `npx vitest run` at the repository root: 240 files, 4206 tests, all passing.
- `packages/sdk` alone: 112 files, 2242 tests. `packages/agent-acp` with `packages/agent-cofold`: 30 files, 408 tests.
- `packages/sdk/test/wire.test.ts` passes with every p2 line out of `KNOWN`, which now holds only p3's lines.
- The section's table was checked against the test by hand: dropping a row from `docs/AHP.md` fails the wire test, and adding one does too.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.

## Departures from the plan

- `DEPARTURES` now holds every name the document's section lists, and the two are compared as sets. The check against the capture's own traffic runs one way only, because a capture asks four of the twenty-two. (defaulted: the plan's task 05 asks the section and the list to name the same entries. The old both-ways check against the traffic cannot do that; recorded in the plan's *Decisions locked in* table, and Softov may reverse it.)
- The plan's `refs` and the five tasks' `refs` were corrected against the code. The plan was written 2026-10-03, before `host.ts` was split into `packages/sdk/src/host/*.ts` and before p1 landed, so every line number in them had moved.
- Added beyond the plan: `steady` in `packages/sdk/test/wire.test.ts` now normalizes the turn id a backend mints from the clock, which is `turn-<milliseconds>`. It was normalized like a UUID before, so every run rewrote `packages/sdk/test/fixtures/wire.jsonl` with a new number. A turn id is mapped to its own counter rather than blanked. Two turns in one capture then stay two, and the UUID numbering does not move.

## Left for later

- The capture still records the machine it was taken on. `packages/sdk/test/fixtures/wire.jsonl` is regenerated on every run, and the `getNetworkDiagnosticsInfo` line carries whatever `ANTHROPIC_BASE_URL` names on the machine that ran it. The committed value is `https://api.anthropic.com/v1/models`.
- The tasks stay `implemented` and the plan is `built`, awaiting Softov's review.
