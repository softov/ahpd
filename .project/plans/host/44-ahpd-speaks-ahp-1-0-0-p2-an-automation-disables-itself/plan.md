---
title: An automation disables itself as its definition says, and a kind given twice is refused
domain: host
status: planned
priority: medium
created: 2026-10-03
revalidated: 2026-10-04
requires:
  - plans/host/44-ahpd-speaks-ahp-1-0-0/plan.md
  - plans/host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md
refs:
  - "[code://packages/sdk/src/host/actions.ts#L403-L423](../../../../packages/sdk/src/host/actions.ts#L403-L423) - `automation/createRequested` and `automation/updateRequested`, which check the resource and nothing in the definition"
  - "[code://packages/sdk/src/automations.ts#L52-L75](../../../../packages/sdk/src/automations.ts#L52-L75) - `entry()`, which builds what a client reads"
  - "[code://packages/sdk/src/automations.ts#L95-L125](../../../../packages/sdk/src/automations.ts#L95-L125) - `create` keeps the definition as sent, `update` merges a patch"
  - "[code://packages/sdk/src/automations.ts#L135-L138](../../../../packages/sdk/src/automations.ts#L135-L138) - `run()` refuses a disabled automation, whatever started it"
  - "[code://packages/sdk/src/automations.ts#L60-L64](../../../../packages/sdk/src/automations.ts#L60-L64) - `entry()` drops `run` from `operations` when `enabled` is `false`"
  - "[code://packages/sdk/src/host/automations.ts#L299-L305](../../../../packages/sdk/src/host/automations.ts#L299-L305) - `runAutomation`, a manual run, answered `-32001` \"or it is switched off\" when `run()` refuses"
  - "[code://packages/sdk/src/scheduled.ts#L36-L48](../../../../packages/sdk/src/scheduled.ts#L36-L48) - the saved file's shape"
  - "[code://packages/sdk/src/scheduled.ts#L179-L196](../../../../packages/sdk/src/scheduled.ts#L179-L196) - `save()` writes what `inner.list()` answers"
  - "[code://packages/sdk/src/scheduled.ts#L234-L276](../../../../packages/sdk/src/scheduled.ts#L234-L276) - `fire()` and `catchUp()`, the only places a scheduled run is admitted"
  - "[code://packages/sdk/src/scheduled.ts#L279-L307](../../../../packages/sdk/src/scheduled.ts#L279-L307) - `load()`, which rebuilds through `inner.create`"
  - "[code://packages/sdk/src/types/automations.ts#L176-L178](../../../../packages/sdk/src/types/automations.ts#L176-L178) - the port's `create` and `update`"
  - "[code://packages/sdk/test/automations.test.ts](../../../../packages/sdk/test/automations.test.ts) - the catalogue through a host"
  - "[code://packages/sdk/test/scheduled.test.ts](../../../../packages/sdk/test/scheduled.test.ts) - the clock, with a test clock and timer"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `AutomationDisableConditionKind` `afterRuns` and `afterDate` (`channels-automation/state.ts:210-251`); `AutomationDefinition.disableConditions` (`:377-393`): logical OR, each kind at most once and a host MUST reject duplicates, manual runs never blocked, a fresh allowance on adding `afterRuns` or on disabled to enabled, clearing does not re-enable; `AutomationEntry.runCount` (`:418-430`)"
---

## Goal

An automation stops scheduling itself after the number of scheduled runs or the date its definition names, and says how many scheduled runs it has used.
A definition that names a disable-condition kind twice is refused, as the protocol requires.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "disableConditions|runCount" packages/*/src` - nothing; the definition is stored and echoed as sent.
- `rg -n "onDue|origin" packages/sdk/src/host/automations.ts packages/sdk/src/scheduled.ts` - a scheduled run reaches `run()` with `origin.kind: 'trigger'`; a manual one with `{ kind: 'manual' }`.
- `rg -n "no\(" packages/sdk/src/host/actions.ts` near :403 - a refused client action is answered through `no(...)`, as a bad resource is today.

### Gaps

- Nothing counts scheduled runs, nothing compares a date, and a duplicate kind is kept.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| A create or update whose `disableConditions` names a kind twice is refused | AHP 1.0.0 `AutomationDefinition.disableConditions`: "hosts MUST reject create or update requests containing duplicate kinds" | 01 |
| A condition that is not one of the two kinds, an `afterRuns` whose `max` is not a positive integer, and an `afterDate` that is not a date are refused too | (defaulted: `AutomationAfterRunsCondition.max` is `@integer @minimum 1`, and a condition the host cannot read is one it cannot honour) | 01 |
| `runCount` counts admitted scheduled runs only, cancelled and failed included, and is absent without an `afterRuns` condition | AHP 1.0.0 `AutomationEntry.runCount` | 02 |
| The count resets to `0` on a disabled-to-enabled update and when `afterRuns` is added where there was none; clearing the conditions leaves `enabled` as it is | AHP 1.0.0 `AutomationDefinition.disableConditions` | 02 |
| When a condition is met the host sets `enabled: false` and announces the entry with `automation/set` | AHP 1.0.0: "the host sets `AutomationDefinition.enabled` to `false` when any condition is met" | 02 |
| The count is kept in the scheduled store's file, beside the definition | AHP 1.0.0: runCount "is NOT reconstructed from runs" | 02 |
| `enabled: false` stops the schedule only: a disabled automation still offers `run`, and `runAutomation` runs it, uncounted | Softov, 2026-10-03, asked "when an automation's disableConditions has disabled it, may a person still run it by hand? The 1.0.0 spec allows a manual run; ahpd blocks any run of a disabled automation today.": "Allow, as the spec"; and asked whether that covers an automation a person switched off: "Any disabled one runs" | 02 |

## Proposed architecture

- **Data flow** - `createRequested` / `updateRequested` -> `disableConditionsProblem(definition)` -> `no(...)` or the store; scheduler `fire()` -> `run(origin: trigger)` -> count +1 -> `enabled: false` when met -> `automation/set`.
- **Layer responsibilities** - sdk host: refusing a definition · memory store: the count, the reset rules, the `afterRuns` check on admitting · scheduled store: the `afterDate` check on the clock, persistence.
- **Source-of-truth files** - [`code://packages/sdk/src/automations.ts`](../../../../packages/sdk/src/automations.ts), [`code://packages/sdk/src/scheduled.ts`](../../../../packages/sdk/src/scheduled.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A definition with a kind twice is refused](task-01-a-definition-with-a-kind-twice-is-refused.md) | todo | - |
| [02 - A scheduled automation counts its runs and switches itself off](task-02-a-scheduled-automation-switches-itself-off.md) | todo | 01 |

## Risks and tradeoffs

- The scheduled store's file gains a field; its `version` stays `1` because an older daemon ignores a key it does not read, and a missing `runCount` reads as `0`.
- Only the memory and scheduled stores are changed; a third-party `AutomationStore` that never sets `runCount` stays valid, since the field is optional.

## Resume state

- **Done so far:** nothing.
- **Next action:** p1 first; then [task-01-a-definition-with-a-kind-twice-is-refused.md](task-01-a-definition-with-a-kind-twice-is-refused.md).
- **Open questions:** none.
- **Watch out for:** a manual run must neither be counted nor be refused by `enabled` or a condition; only `origin.kind === 'trigger'` counts and is gated.

## Final verification checklist

- [ ] An automation with `afterRuns: 2` fires twice on a test clock and is then announced with `enabled: false` and `runCount: 2`.
- [ ] That automation still offers `run`, and `runAutomation` starts a run without changing `runCount`.
- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [ ] `plans/index.md` updated.
