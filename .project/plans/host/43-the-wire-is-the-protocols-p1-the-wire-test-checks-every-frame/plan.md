---
title: The wire test checks every request, result and notification against the protocol
domain: host
status: built
priority: high
created: 2026-10-03
revalidated: 2026-10-07
requires:
  - plans/host/43-the-wire-is-the-protocols/plan.md
  - plans/host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md
refs:
  - "[code://tools/schema.mjs#L88-L102](../../../../tools/schema.mjs#L88-L102) - `nameOf` names a type by its alias, so `Partial<SessionSummary>` and `Partial<ChatSummary>` are both `Partial`"
  - "[code://tools/schema.mjs#L248-L255](../../../../tools/schema.mjs#L248-L255) - the first named object becomes the one `$defs` entry every later one points at"
  - "[code://tools/schema.mjs#L178-L183](../../../../tools/schema.mjs#L178-L183) - a union of literals becomes an `enum`, which is how `SessionStatus` is checked"
  - "[code://tools/wire.mjs#L293-L357](../../../../tools/wire.mjs#L293-L357) - `frame()` routes by `CommandMap`, `ServerCommandMap`, `ServerNotificationMap` and `ClientNotificationMap`"
  - "[code://packages/sdk/test/wire.test.ts#L199-L210](../../../../packages/sdk/test/wire.test.ts#L199-L210) - `asking` records the handler's return, not the response frame `rpc.ts` sends"
  - "[code://packages/sdk/test/wire.test.ts#L442-L443](../../../../packages/sdk/test/wire.test.ts#L442-L443) - `completions` sent `position` and `sessionConfigCompletions` sent `key`"
  - "[code://packages/sdk/test/wire.test.ts#L448-L451](../../../../packages/sdk/test/wire.test.ts#L448-L451) - `createTerminal` sent `command` and no `claim`"
  - "[code://packages/sdk/src/rpc.ts#L168-L182](../../../../packages/sdk/src/rpc.ts#L168-L182) - `resultFrame`, how a handler's return becomes the response frame"
  - "[code://tools/validate.mjs](../../../../tools/validate.mjs) - the same checker over a capture taken off a daemon"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `CommandMap` (`src/types/common/messages.ts:162-194`), `ServerNotificationMap` (`:247-257`), `SessionStatus` bit flags (`src/types/channels-session/state.ts:58-71`), `SessionSummary.chats` and `defaultChat` with `SessionChatSummary.status` (`:521-568`), `CompletionsParams` (`kind`, `channel`, `text`, `offset`), `SessionConfigCompletionsParams` (`property`), `CreateTerminalParams` (`claim` required)"
---

## Goal

The wire test checks every frame a client would receive and every request it sends. Request params and results go by `CommandMap`, notifications by `ServerNotificationMap`, and `_meta` keys by ahpd's own list.
It runs over the traffic the audit needed. It lands green by naming today's defects, each with the plan that removes it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `node -e` over `tools/ahp.strict.schema.json` shows one `Partial` definition, whose `origin` is `ChatSummary`'s. `root/sessionSummaryChanged` would be checked against a chat. `SessionStatus` is `{ enum: [1, 2, 8, 24, 32, 64] }`, so `33` (idle and read) fails.
- `rg -n "params\.\w+" packages/sdk/src/host.ts` in `completions` (:7926) and `sessionConfigCompletions` (:9489) - the host reads `kind`, `offset` and `property`, the protocol's names; only the test is wrong.
- `comm` of the host's handler names against `CommandMap` - the bare `shutdown`, `getNetworkDiagnosticsInfo`, `getManagedSettingsDiagnostics`, `diagnosticsFetch` and the `vscode/*` requests are outside it.

### Gaps

- A defect in a result outside a snapshot, in a request's params or in `root/sessionSummaryChanged` cannot be found by the test today.
- `_meta` is an open record in the schema, so an unprefixed key ahpd invents passes any schema check.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Each `Partial<T>` is its own definition, named after `T` | the audit: one `Partial` definition wrongly flags `project` and `_meta` on `root/sessionSummaryChanged` | 01 |
| `SessionStatus` is checked as bit flags | AHP 1.0.0 `channels-session/state.ts:58-71` | 01 |
| `PartialSessionSummary` also checks `chats` and `defaultChat`, and the bit-flag check also covers `SessionChatSummary.status` | AHP 1.0.0 `SessionSummary` (`channels-session/state.ts:521-568`) | 01 |
| Requests, results and notifications are routed by `CommandMap` and `ServerNotificationMap`, not by name guessing | the request, 2026-10-03, item 8 | 02 |
| A recorded result is what `rpc.ts` puts on the wire, from one function both use | (defaulted: a test that records something other than the frame proves nothing about the frame) | 03 |
| The traffic includes a users directory, a signed-in person on a team, an automation with an owner and its run, and the daemon's root config with a plugin's options | the request, 2026-10-03, item 8 | 03 |
| The test sends the protocol's param names | AHP 1.0.0 `CompletionsParams`, `SessionConfigCompletionsParams`, `CreateTerminalParams` | 03 |
| The test lands green with today's defects in a known list, each line naming the plan that removes it, and fails on any defect not in the list or any listed one that no longer occurs | (defaulted: the fixes land one by one and each must be proven by its own line leaving) | 03 |
| The deliberate departures are a list in the test, and each one is named in `docs/AHP.md` | the request, 2026-10-03, item 6 | 03 |
| `moveChat` is in `CommandMap` and not served; it needs no `DEPARTURES` entry, which lists what ahpd sends or serves outside the maps | (defaulted: a method nobody calls is not traffic, and its absence is `UPSTREAM.md`'s backlog, not a departure) | 03 |
| The strict schema is rebuilt when the installed package changes by host/44 p1 task 03, not here | the request, 2026-10-03: "the stale-schema guard is host/44 p1's (do not duplicate)" | - |
| Every `_meta` key is either `ahpd.`-prefixed or one of the reference's own keys at the place the reference reads it; today's unprefixed ones are a pending list p4 empties | Softov, 2026-10-03, "Rename all + clients" | 04 |
| The protocol's test cases from tag `v1.0.0` run against the package's reducers and through ahpd's host; `null` and an absent key compare equal | Softov, 2026-10-07, chose host/43 next on the proposal "adding upstream's reducer test cases", as two reviewed AHP projects do | 05 |
| `describes` composes what the backend put in a session's `_meta` with what the host puts there, the host's keys winning a collision | (defaulted: a fix, not asked; `describes` replaced `_meta` whole and erased the backend's `model`; Softov may reverse it) | 03 |

## Proposed architecture

- **Data flow** - the test records each exchange as `{ asked, params, result | error }` and each notification as `{ method, params }`; `tools/wire.mjs` routes each by the generated `CommandMap` and `ServerNotificationMap` definitions.
- **Layer responsibilities** - tools: the schema and the router. The sdk holds the recorded host, and the one function that shapes a result frame. The server holds the root config port the test builds the host with.
- **Source-of-truth files** - [`code://tools/wire.mjs`](../../../../tools/wire.mjs), [`code://packages/sdk/test/wire.test.ts`](../../../../packages/sdk/test/wire.test.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The schema has one Partial per type, and status as bit flags](task-01-the-schema-has-one-partial-per-type.md) | done | - |
| [02 - The checker routes requests, results and notifications by the protocol's maps](task-02-the-checker-routes-by-the-protocols-maps.md) | done | 01 |
| [03 - The wire test records what the host sends, over a host with people, automations and root config](task-03-the-wire-test-records-a-whole-host.md) | done | 02 |
| [04 - The wire test names every _meta key ahpd writes](task-04-the-wire-test-names-every-meta-key.md) | done | 03 |
| [05 - The protocol's own test cases run against ahpd, from the tag ahpd pins](task-05-the-upstream-test-cases-run.md) | done | - |

## Risks and tradeoffs

- A known-defects list can become a place defects live; each line names its plan, and the parent closes only when the list is empty.
- `SubscribeResult.snapshot.state` is a union with no tag. So the test takes the state out and checks it by its channel, as today.

## Resume state

- **Done so far:** every task, 01 to 05. The schema gives every `Partial<T>` its own definition, and closes `SessionStatus` as bit flags. `frame()` routes each exchange by the protocol's four maps. The wire test records what `resultFrame` sends, over a host with people, automations and root config. It checks 236 payloads against 508 declarations. Every `_meta` key in the capture is prefixed, the reference's, or on p4's list. The protocol's own cases from tag `v1.0.0` run against the package's reducers, its round trips, its negotiation rows, and a host. 308 reducer cases, 67 round trips and 22 negotiation rows run. Of the 248 root, session and chat cases, 29 are compared and 205 are refused and named with the reason.
- **Next action:** none. Reviewed and closed on 2026-10-07.
- **Open questions:** none. The `model` fork is closed by a defaulted fix: `describes` composes the backend's `_meta` with the host's, so `model` survives on the state and on the row. Task 03 of p4 can drop it from `PENDING`.
- **Watch out for:** the audit's `null`-result check compared the frame after `result ?? {}`. Record through the shared function. Without it, the test passes on `undefined` while the wire says `{}`. The guard that rebuilds a stale `ahp.strict.schema.json` is host/44 p1 task 03's. Do not add a second one. The cases under `packages/sdk/test/fixtures/ahp-test-cases` are a copy of one tag. The test refuses to run while the copy and the installed package disagree. A package bump needs `node tools/ahp-test-cases.mjs <tag> --from <checkout>` in the same change.

## Final verification checklist

- [x] `node tools/schema.mjs` emits `PartialSessionSummary` and `PartialChatSummary`, and no `Partial`.
- [x] The wire test fails when any listed known defect is fixed without removing its line, and when an unlisted one appears.
- [x] `pnpm test` passes.
- [x] `plans/index.md` updated.
