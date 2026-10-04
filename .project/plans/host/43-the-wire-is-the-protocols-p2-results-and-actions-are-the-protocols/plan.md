---
title: Results and actions are the protocol's shapes
domain: host
status: planned
priority: high
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/43-the-wire-is-the-protocols/plan.md
  - plans/host/43-the-wire-is-the-protocols-p1-the-wire-test-checks-every-frame/plan.md
  - plans/host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md
refs:
  - "[code://packages/sdk/src/rpc.ts#L220](../../../../packages/sdk/src/rpc.ts#L220) - `result ?? {}`, which also turns a handler's `null` into `{}`"
  - "[code://packages/sdk/src/host.ts#L7667](../../../../packages/sdk/src/host.ts#L7667) - `ping` answers `{}`"
  - "[code://packages/sdk/src/host.ts#L8457-L8460](../../../../packages/sdk/src/host.ts#L8457-L8460) - `fetchAutomationRuns` answers the store's page"
  - "[code://packages/sdk/src/automations.ts#L51-L60](../../../../packages/sdk/src/automations.ts#L51-L60) - `entry()` always carries the first page of runs"
  - "[code://packages/sdk/src/automations.ts#L260-L269](../../../../packages/sdk/src/automations.ts#L260-L269) - `runs()` answers `items` and `nextCursor`"
  - "[code://packages/sdk/src/types/automations.ts#L208-L209](../../../../packages/sdk/src/types/automations.ts#L208-L209) - the store's `runs` signature"
  - "[code://packages/agent-claude/src/session.ts#L2085](../../../../packages/agent-claude/src/session.ts#L2085) - `chat/inputRequested` with `turnId`"
  - "[code://examples/notes/agent.ts#L271](../../../../examples/notes/agent.ts#L271) - the same in the notes example"
  - "[code://packages/sdk/src/host.ts#L4762-L4776](../../../../packages/sdk/src/host.ts#L4762-L4776) - `published()`, the one road a backend's session schema leaves by"
  - "[code://packages/sdk/src/host.ts#L6537-L6540](../../../../packages/sdk/src/host.ts#L6537-L6540) - the session state spreads the backend's whole answer"
  - "[code://docs/AHP.md#L742-L763](../../../../docs/AHP.md#L742-L763) - the bare requests, described and not marked as outside the protocol"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `CommandMap` results `null` (`src/types/common/messages.ts:164-173`); `FetchAutomationRunsResult {}`, delivered by action (`channels-automation/commands.ts:95-125`); `ChatInputRequestedAction` has `type` and `request` (`channels-chat/actions.ts:908-912`); `SessionConfigSchema` requires `type`; `SessionState` declares no `resource`"
---

## Goal

Every request ahpd answers has the protocol's result, `null` where it says `null`, and an older page of automation runs arrives the way the protocol says, on `automation/set`.
No action or state carries a field the protocol does not declare, and the session config schema always says it is an object.
What ahpd keeps for VS Code is written down as a departure.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "return \{\};"` in the seven handlers - `ping` (:7667), `createTerminal` (:8231), `disposeTerminal` (:8242), `createSession` (:8867), `createChat` (:8991), `disposeChat` (:9022), `disposeSession` (:9026).
- `rg -n "sessionState: \(\) => \(\{" -A3 packages examples` - `resource: start.uri` in `examples/echo/agent.ts:232`, `examples/notes/agent.ts:569`, `packages/agent-acp/src/session.ts:1748`, `packages/agent-cofold/src/session.ts:1239`; the audit saw only echo's because only echo and claude ran.
- `rg -n "fetchAutomationRuns|runsNextCursor"` in ahpapp - it already sends the cursor from `AutomationEntry.runsNextCursor` and reads the page from the entry (`src/useAutomations.ts:137-139`, `app/(tabs)/automations.tsx:567-570`).
- `rg -n "automationRuns"` in ahpc - `src/ahp/live.ts:2436-2445` reads `result.runs`, and `src/cli/main.ts:1258-1264` pages through it.

### Gaps

- `rpc.ts` cannot send `null`: `??` turns it into `{}`, so the handlers' change alone does nothing.
- The store has no notion of a page loaded beyond the first, so `entry()` cannot grow.
- `docs/AHP.md` has no list of what is served outside `CommandMap`, and does not mention `vscode/devContainers/*` at all.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| `ping`, `createSession`, `disposeSession`, `createChat`, `disposeChat`, `createTerminal`, `disposeTerminal` answer `null` | AHP 1.0.0 `CommandMap` (`common/messages.ts:164-173`) | 01 |
| A handler's `null` goes on the wire as `null`, and `undefined` still as `{}` | (defaulted: the other results that are empty objects, `FetchTurnsResult` among them, keep their `{}`) | 01 |
| `fetchAutomationRuns` answers `{}`, and the older page arrives by `automation/set` with more `runs` and the next `runsNextCursor` | AHP 1.0.0 `FetchAutomationRunsResult` | 02 |
| How many runs an automation shows is one count per automation, shared by every subscriber | AHP 1.0.0: "keeping all catalogue subscribers synchronized" | 02 |
| An unrecognised cursor is refused with `-32602` | (defaulted: `FetchTurnsParams.cursor` says the host MUST reject one, and the two pagers should agree) | 02 |
| `chat/inputRequested` carries `type` and `request` only | AHP 1.0.0 `ChatInputRequestedAction` | 03 |
| The host sets `type: 'object'` on every session config schema it publishes | the request, 2026-10-03: "the host sets it" | 04 |
| `SessionState` carries no `resource`: the host strips it from a backend's answer, and echo, notes, acp and cofold stop sending it | the request, 2026-10-03, item 5; the host strip (defaulted: one place covers a third-party backend too) | 04 |
| `activity: null`, the bare requests, the `vscode/*` requests and the `vscode/devContainers/*` notifications stay, written down as deliberate departures | the request, 2026-10-03: "Keep, for VS Code parity (do not change)" | 05 |

## Proposed architecture

- **Data flow** - `fetchAutomationRuns` -> store advances the automation's loaded count -> `automation/set` with the longer `runs` -> every catalogue subscriber; the request answers `{}`.
- **Layer responsibilities** - sdk: rpc, host, automations store · agent-claude, examples: the action · agent-acp, agent-cofold, examples: the session state · docs.
- **Source-of-truth files** - [`code://packages/sdk/src/automations.ts`](../../../../packages/sdk/src/automations.ts), [`code://packages/sdk/src/rpc.ts`](../../../../packages/sdk/src/rpc.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The seven acknowledgements answer null](task-01-the-seven-acknowledgements-answer-null.md) | todo | - |
| [02 - An older page of runs arrives on automation/set](task-02-an-older-page-of-runs-arrives-on-automation-set.md) | todo | - |
| [03 - chat/inputRequested carries only its request](task-03-input-requested-carries-only-its-request.md) | todo | - |
| [04 - The session state says only what SessionState declares](task-04-the-session-state-says-only-what-it-declares.md) | todo | - |
| [05 - The departures kept for VS Code are written down](task-05-the-departures-are-written-down.md) | todo | - |

## Risks and tradeoffs

- ahpc's `automationRuns` reads `result.runs`, which ahpd has never sent (it sends `items`), so ahpc's run history has always been one page; after 02 it must read the entry, as ahpapp already does.
- A client that treats a `null` result as a failure would break; ahpapp and ahpc read results through `bag()`, which takes `null`.

## Resume state

- **Done so far:** nothing.
- **Next action:** p1 first; then [task-01-the-seven-acknowledgements-answer-null.md](task-01-the-seven-acknowledgements-answer-null.md), and 02 to 05 in any order.
- **Open questions:** none.
- **Watch out for:** each task removes its own lines from p1's `KNOWN` list, and only those.

## Final verification checklist

- [ ] p1's `KNOWN` list holds no line naming p2.
- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [ ] `plans/index.md` updated.
