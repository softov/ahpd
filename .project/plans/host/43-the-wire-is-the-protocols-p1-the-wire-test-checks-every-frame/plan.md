---
title: The wire test checks every request, result and notification against the protocol
domain: host
status: planned
priority: high
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/43-the-wire-is-the-protocols/plan.md
refs:
  - "[code://tools/schema.mjs#L58-L64](../../../../tools/schema.mjs#L58-L64) - `nameOf` names a type by its alias, so `Partial<SessionSummary>` and `Partial<ChatSummary>` are both `Partial`"
  - "[code://tools/schema.mjs#L176-L185](../../../../tools/schema.mjs#L176-L185) - the first named object becomes the one `$defs` entry every later one points at"
  - "[code://tools/schema.mjs#L109-L114](../../../../tools/schema.mjs#L109-L114) - a union of literals becomes an `enum`, which is how `SessionStatus` is checked"
  - "[code://tools/wire.mjs#L167-L205](../../../../tools/wire.mjs#L167-L205) - `frame()` routes snapshots, a resolved config and `action` notifications, and nothing else"
  - "[code://packages/sdk/test/wire.test.ts#L157-L162](../../../../packages/sdk/test/wire.test.ts#L157-L162) - `asking` records the handler's return, not the response frame `rpc.ts` sends"
  - "[code://packages/sdk/test/wire.test.ts#L272-L273](../../../../packages/sdk/test/wire.test.ts#L272-L273) - `completions` sent `position` and `sessionConfigCompletions` sent `key`"
  - "[code://packages/sdk/test/wire.test.ts#L278](../../../../packages/sdk/test/wire.test.ts#L278) - `createTerminal` sent `command` and no `claim`"
  - "[code://packages/sdk/src/rpc.ts#L216-L221](../../../../packages/sdk/src/rpc.ts#L216-L221) - how a handler's return becomes the response frame"
  - "[code://tools/validate.mjs](../../../../tools/validate.mjs) - the same checker over a capture taken off a daemon"
  - "npm://@microsoft/agent-host-protocol@0.9.0 - `CommandMap` (`src/types/common/messages.ts:160-191`), `ServerNotificationMap` (`:244-254`), `SessionStatus` bit flags (`src/types/channels-session/state.ts:56-69`), `CompletionsParams` (`kind`, `channel`, `text`, `offset`), `SessionConfigCompletionsParams` (`property`), `CreateTerminalParams` (`claim` required)"
---

## Goal

The wire test checks every frame a client would receive and every request it sends: request params and results by `CommandMap`, notifications by `ServerNotificationMap`, and the `_meta` keys ahpd writes.
It runs over the traffic the audit needed to find what it found, and it lands green by naming today's defects, each with the plan that removes it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `node -e` over `tools/ahp.strict.schema.json` - one `Partial` definition, whose `origin` is `ChatSummary`'s, so `root/sessionSummaryChanged` would be checked against a chat; `SessionStatus` is `{ enum: [1, 2, 8, 24, 32, 64] }`, so `33` (idle and read) fails.
- `rg -n "params\.\w+" packages/sdk/src/host.ts` in `completions` (:7926) and `sessionConfigCompletions` (:9489) - the host reads `kind`, `offset` and `property`, the protocol's names; only the test is wrong.
- `comm` of the host's handler names against `CommandMap` - the bare `shutdown`, `getNetworkDiagnosticsInfo`, `getManagedSettingsDiagnostics`, `diagnosticsFetch` and the `vscode/*` requests are outside it.

### Gaps

- A defect in a result outside a snapshot, in a request's params or in `root/sessionSummaryChanged` cannot be found by the test today.
- `_meta` is an open record in the schema, so an unprefixed key ahpd invents passes any schema check.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Each `Partial<T>` is its own definition, named after `T` | the audit: one `Partial` definition wrongly flags `project` and `_meta` on `root/sessionSummaryChanged` | 01 |
| `SessionStatus` is checked as bit flags | AHP 0.9.0 `channels-session/state.ts:56-69` | 01 |
| Requests, results and notifications are routed by `CommandMap` and `ServerNotificationMap`, not by name guessing | the request, 2026-10-03, item 8 | 02 |
| A recorded result is what `rpc.ts` puts on the wire, from one function both use | (defaulted: a test that records something other than the frame proves nothing about the frame) | 03 |
| The traffic includes a users directory, a signed-in person on a team, an automation with an owner and its run, and the daemon's root config with a plugin's options | the request, 2026-10-03, item 8 | 03 |
| The test sends the protocol's param names | AHP 0.9.0 `CompletionsParams`, `SessionConfigCompletionsParams`, `CreateTerminalParams` | 03 |
| The test lands green with today's defects in a known list, each line naming the plan that removes it, and fails on any defect not in the list or any listed one that no longer occurs | (defaulted: the fixes land one by one and each must be proven by its own line leaving) | 03 |
| The deliberate departures are a list in the test, and each one is named in `docs/AHP.md` | the request, 2026-10-03, item 6 | 03 |
| Every `_meta` key is either `ahpd.`-prefixed or one of the reference's own keys at the place the reference reads it; today's unprefixed ones are a pending list p4 empties | Softov, 2026-10-03, "Rename all + clients" | 04 |

## Proposed architecture

- **Data flow** - the test records each exchange as `{ asked, params, result | error }` and each notification as `{ method, params }`; `tools/wire.mjs` routes each by the generated `CommandMap` and `ServerNotificationMap` definitions.
- **Layer responsibilities** - tools: the schema and the router · sdk: the recorded host and the one function that shapes a result frame · server: the root config port the test builds the host with.
- **Source-of-truth files** - [`code://tools/wire.mjs`](../../../../tools/wire.mjs), [`code://packages/sdk/test/wire.test.ts`](../../../../packages/sdk/test/wire.test.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The schema has one Partial per type, and status as bit flags](task-01-the-schema-has-one-partial-per-type.md) | todo | - |
| [02 - The checker routes requests, results and notifications by the protocol's maps](task-02-the-checker-routes-by-the-protocols-maps.md) | todo | 01 |
| [03 - The wire test records what the host sends, over a host with people, automations and root config](task-03-the-wire-test-records-a-whole-host.md) | todo | 02 |
| [04 - The wire test names every _meta key ahpd writes](task-04-the-wire-test-names-every-meta-key.md) | todo | 03 |

## Risks and tradeoffs

- A known-defects list can become a place defects live; each line names its plan, and the parent closes only when the list is empty.
- `SubscribeResult.snapshot.state` is a union with no tag, so the result is checked with the state taken out and the state checked by its channel, as today.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-schema-has-one-partial-per-type.md](task-01-the-schema-has-one-partial-per-type.md).
- **Open questions:** none.
- **Watch out for:** the audit's `null`-result check compared the frame after `result ?? {}`; record through the shared function, or the test passes on `undefined` while the wire says `{}`.

## Final verification checklist

- [ ] `node tools/schema.mjs` emits `PartialSessionSummary` and `PartialChatSummary`, and no `Partial`.
- [ ] The wire test fails when any listed known defect is fixed without removing its line, and when an unlisted one appears.
- [ ] `pnpm test` passes.
- [ ] `plans/index.md` updated.
