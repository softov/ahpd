---
title: An automation's owner rides in _meta, where the protocol has room for it
domain: host
status: built
priority: high
created: 2026-10-03
refs:
  - "[code://packages/sdk/src/types/automations.ts#L15-L55](../../../../packages/sdk/src/types/automations.ts#L15-L55) - `Automation.owner` and `AutomationRun.owner`, ahpd fields on the protocol shapes"
  - "[code://packages/sdk/src/automations.ts#L52-L65](../../../../packages/sdk/src/automations.ts#L52-L65) - `entry()` spreads the whole record, `owner` included, onto the `automation/set` entry"
  - "[code://packages/sdk/src/automations.ts#L136-L150](../../../../packages/sdk/src/automations.ts#L136-L150) - the run record, which carries `owner` onto the run state"
  - "[code://packages/sdk/src/automations.ts#L171](../../../../packages/sdk/src/automations.ts#L171) - `StartSession.owner`, ahpd's own options, which never reach the wire and stay"
  - "[code://packages/sdk/test/wire.test.ts](../../../../packages/sdk/test/wire.test.ts) - records the host's frames and checks each against the protocol schema"
  - "npm://@microsoft/agent-host-protocol@0.9.0 - `AutomationEntry._meta` (channels-automation/state.ts:331) and `AutomationRunState._meta` (channels-automation-run/state.ts:253); neither declares `owner`"
---

## Goal

ahpd sends no field the protocol does not declare on an automation or a run.
An automation's owner and a run's owner reach a client as `_meta['ahpd.owner']`, the same `Owner` value as today, and the host keeps reading `owner` off its own stored record.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "owner" packages/sdk/src/automations.ts` - the create (:90), the run (:147) and `StartSession` (:171).
- `rg -n "interface AutomationSetAction|interface AutomationEntry|interface AutomationRunState" node_modules/.pnpm/@microsoft+agent-host-protocol@0.9.0` - `automation/set` carries an `AutomationEntry`, which has `_meta`; the run state has `_meta`.
- `rg -o "'ahpd\.[a-zA-Z.]+'" packages/sdk/src` - ahpd's `_meta` keys are `ahpd.<name>`.
- `/github/ahpapp`, `/github/ahpc` - no reader of an automation's or a run's `owner` found.

### Gaps

- On a host with a users directory every automation and run frame carries `owner`, which the protocol does not declare.
- The wire test's recorded traffic comes from a host with no users directory, so `owner` was never set while the schema check ran; host/40 moved that traffic to a signed-in person and the check refused `owner` five times.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| `owner` leaves the wire shapes and is sent as `_meta['ahpd.owner']` | the protocol: `AutomationEntry` and `AutomationRunState` declare `_meta` and no `owner` | 01 |
| The stored records keep `owner`; only what is sent changes | (defaulted: the host's gates read it there, and the store is not the wire) | 01 |
| The wire test's traffic includes a host with a users directory and a signed-in person | (defaulted: a schema check that never sees the field cannot catch it) | 01 |

## Proposed architecture

- **Data flow** - the stored `Automation` and `AutomationRun` keep `owner`; the function that answers the wire entry and the run state moves it into `_meta['ahpd.owner']`, beside any `_meta` already there.
- **Layer responsibilities** - sdk only.
- **Source-of-truth files** - [`code://packages/sdk/src/automations.ts`](../../../../packages/sdk/src/automations.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An automation's owner is sent in _meta](task-01-the-owner-is-sent-in-meta.md) | done | - |

## Risks and tradeoffs

- A client that reads `owner` off an automation stops seeing it; none was found, and `_meta['ahpd.owner']` is where it reads now.
- host/40 waits on this: its wire test runs on a signed-in person and fails until `owner` is off the wire.

## Resume state

- **Done so far:** built 2026-10-03, see [implemented.md](implemented.md).

## Final verification checklist

- [x] On a host with a users directory, every `automation/set` entry and run state passes the protocol schema, and carries `_meta['ahpd.owner']`.
- [x] An automation's run still starts as its owner, and an owner who has not signed in is still refused.
- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [x] `plans/index.md` updated.
