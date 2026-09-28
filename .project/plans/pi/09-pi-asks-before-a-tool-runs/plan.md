---
title: pi asks a person before a tool runs
domain: pi
status: built
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/pi/02-host-and-client-tools-reach-pi/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-pi/src/session.ts#L15-L17](../../../../packages/agent-pi/src/session.ts#L15-L17) - the header: no call is ever `pending-confirmation`"
  - "[code://packages/agent-pi/src/session.ts#L557-L563](../../../../packages/agent-pi/src/session.ts#L557-L563) - `confirm` does nothing"
  - "[code://packages/agent-pi/src/session.ts#L110-L118](../../../../packages/agent-pi/src/session.ts#L110-L118) - `status` never reaches `InputNeeded`"
  - "[code://packages/agent-pi/src/mapping.ts#L129-L150](../../../../packages/agent-pi/src/mapping.ts#L129-L150) - every call is readied `confirmed: 'not-needed'`"
  - "[code://packages/agent-pi/README.md#L56](../../../../packages/agent-pi/README.md#L56) - the README says no call is ever asked about"
  - "[code://packages/agent-claude/src/session.ts#L572-L586](../../../../packages/agent-claude/src/session.ts#L572-L586) - `pending`, every question by id, the map to copy"
  - "[code://packages/agent-claude/src/session.ts#L1119-L1122](../../../../packages/agent-claude/src/session.ts#L1119-L1122) - `status` is `InputNeeded` while anything is pending"
  - "[code://packages/agent-claude/src/session.ts#L1134-L1139](../../../../packages/agent-claude/src/session.ts#L1134-L1139) - `session/inputNeededSet` and `session/inputNeededRemoved` by id"
  - "[code://packages/agent-claude/src/session.ts#L1709-L1858](../../../../packages/agent-claude/src/session.ts#L1709-L1858) - `canUseTool`: the call opened `pending-confirmation` with a `confirmationTitle`, a `toolConfirmation` entry, and a wait"
  - "[code://packages/agent-claude/src/session.ts#L3226-L3262](../../../../packages/agent-claude/src/session.ts#L3226-L3262) - `confirm`: found by call id, answered with `chat/toolCallConfirmed`, then the wait is settled"
  - "[code://packages/agent-claude/src/claude.ts#L166-L189](../../../../packages/agent-claude/src/claude.ts#L166-L189) - the `permissionMode` session key a client draws its approvals picker from"
  - "[code://packages/agent-cofold/src/agent.ts#L115-L135](../../../../packages/agent-cofold/src/agent.ts#L115-L135) - the other sibling's six modes, decided from a tool's effects"
  - "[code://.project/decisions/permission-modes-live-in-the-harness.md](../../../../.project/decisions/permission-modes-live-in-the-harness.md) - why the six modes are the same six on every backend"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - `AgentSession` owns pi-agent-core's `beforeToolCall` and routes it to extensions' `tool_call` handlers (`dist/core/agent-session.js`, `_installAgentToolHooks`); an inline extension comes in through `resourceLoaderOptions.extensionFactories`; `ToolCallEventResult` is `{ block, reason }`, in `dist/core/extensions/types.d.ts`
  - npm://@earendil-works/pi-agent-core@0.87.1 - `beforeToolCall`, in `dist/types.d.ts`
---

## Goal

A pi session asks a person before a tool runs, the same way a Claude session does, and runs or refuses the call on their answer.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -n "beforeToolCall" dist/core/agent-session.js` in pi 0.87.1 - `AgentSession` sets `agent.beforeToolCall` itself and turns it into the extensions' `tool_call` event, so replacing it would switch off every project extension's hook.
- `grep -n "loadExtensionFactories" dist/core/resource-loader.js` - inline extensions load after the file ones, so their `tool_call` handler sees the input the others left, and the first handler that blocks wins.
- `rg -n "permissionMode" packages/*/src` - Claude and cofold advertise the same six-value key.

### Runtime path

```
model calls a tool -> pi beforeToolCall -> extension tool_call handlers -> [new] ahpd's inline handler
  -> policy says ask -> chat/toolCallStart + chat/toolCallReady (pending-confirmation) + session/inputNeededSet -> wait
client confirm(toolCallId, approved) -> chat/toolCallConfirmed + session/inputNeededRemoved
  -> approved: handler returns nothing, pi runs the tool; declined: { block: true, reason }
```

### Gaps

- Nothing is ever asked, and `confirm` does nothing.
- pi asks before `tool_execution_start`, so the call row has to exist before pi's own event opens it, and that event must not ready it again as `not-needed`.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Approvals are planned now, as their own plan | Softov, 2026-09-26: "approvals now as its plan... we cannot wait for something that could not exist" | 01, 02 |
| The hook is an inline pi extension's `tool_call` handler, passed through `resourceLoaderOptions.extensionFactories`, not a replacement `beforeToolCall` | Softov, 2026-09-26, naming "pi-agent-core's `beforeToolCall` or an extension's `tool_call` hook"; pi 0.87.1 owns `beforeToolCall` for its extensions, so only the hook leaves them working | 01 |
| The asking mirrors `@ahpd/agent-claude`: a `pending` map by id, the call opened `pending-confirmation`, a `toolConfirmation` input entry, `InputNeeded` status, `confirm` found by call id and said back with `chat/toolCallConfirmed` | Softov, 2026-09-26: "Mirror how `@ahpd/agent-claude` asks" | 01 |
| Which calls ask is the six-value `permissionMode` session key Claude and cofold advertise, default `default`; pi's `edit`, `write` and `bash` are judged by name and a host tool by its `effects`, as cofold does | Softov, 2026-09-26, answering which calls pi asks about: "use `permissionMode`, the same six-value key that Claude and cofold have, defaulting to `default`" | 02 |
| A declined call is blocked with a reason the model reads, and a cancelled turn declines what is still waiting | [`code://packages/agent-claude/src/session.ts#L3257-L3259`](../../../../packages/agent-claude/src/session.ts#L3257-L3259) | 01 |
| The ask reuses the row pi opened at `tool_execution_start`, since pi emits it before the `tool_call` hook. | Softov, 2026-09-27, asked which review findings in the pi batch become fix tasks: "B1 ask comes after start"; pi-agent-core 0.87.1 `agent-loop.js` | 04 |
| A path is judged after pi's own resolution and symlinks, and a pi built-in keeps its own effects. | Softov, 2026-09-27, asked which review findings in the pi batch become fix tasks: "B2 acceptEdits path check", "B5 dropped tool's effects" | 05 |
| A tool with no `effects` runs, as cofold's does. | Softov, 2026-09-27, asked how the modes treat a tool with no effects: "Run it, as cofold does". | 05 |
| A read outside the workspace asks in `default`, `acceptEdits` and `plan`, and is refused in `dontAsk`, as cofold's does. | Softov, 2026-09-27, asked whether pi matches cofold on reads outside: "Match cofold". | 05 |
| A cancel answers each question with `chat/toolCallConfirmed` and "The turn was stopped". | Softov, 2026-09-27, asked which review findings in the pi batch become fix tasks: "B6 cancel and pending asks" | 06 |
| The `Asking` seam goes and the ask cases drive `permissionMode`; the README and comments are corrected; a wire capture is validated. | Softov, 2026-09-27, asked which review findings in the pi batch become fix tasks: "Drop the Asking seam", "README and comments true", "pnpm wire on a capture" | 07, 08, 09 |
| The undeclared `session/statusChanged` and `session/modelsChanged` actions are removed, status reaching a client as the declared `session/chatUpdated` and a session's models left to `Session.models()` | Softov, 2026-09-27, answering how the capture should pass `pnpm wire`: "Remove both emits from packages/agent-pi" | 09 |
| A call pi failed before its hook is readied `not-needed` at its end, so a client can complete it. | Softov, 2026-09-27, asked how to handle the call that stays `streaming`: "I fix it now, then commit" | 10 |
| `sessionState` carries `inputNeeded`, as claude and cofold do. | Softov, 2026-09-28, approved reproducing the stuck third permission: "Yes, reproduce"; the fix mirrors the siblings. | 11 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A call can wait on a person](task-01-a-call-can-wait-on-a-person.md) | done | - |
| [02 - A mode says which calls ask](task-02-a-mode-says-which-calls-ask.md) | done | 01 |
| [03 - The README says pi asks](task-03-the-readme-says-pi-asks.md) | done | 02 |
| [04 - The ask reuses the row pi already opened, and a client tool runs only after it is approved](task-04-the-ask-reuses-the-row-pi-opened.md) | done | 01 |
| [05 - A path is judged where pi puts it, reads outside the workspace ask, and pi's own tools keep their effects](task-05-a-path-is-judged-where-pi-puts-it.md) | done | 02 |
| [06 - A cancel answers every question it leaves](task-06-a-cancel-answers-what-it-asked.md) | done | 04 |
| [07 - piSession has no test-only parameter](task-07-no-test-only-seam.md) | done | 05 |
| [08 - The README and the comments say what the code does](task-08-the-readme-and-comments-say-what-is-true.md) | done | 07 |
| [09 - A captured pi session validates against the protocol schema](task-09-a-wire-capture-validates.md) | done | 08 |
| [10 - A call pi failed before its hook still closes in a client](task-10-a-call-pi-failed-first-still-closes.md) | done | 04 |
| [11 - A client that reconnects sees what pi is waiting on](task-11-a-reconnected-client-sees-the-question.md) | done | 01 |

## Risks and tradeoffs

- A project extension that blocks a call first means ahpd's handler is never reached for it; that is pi's order and the call is refused either way.
- A rebuild of pi from plan 02 task 03 must pass the inline extension again, or asking stops after the tools change.
- Under `projectTrust: deny` project extensions do not load; the inline one still must, which task 01 checks.

## Resume state

- **Done so far:** every task is `done`, reviewed by Softov on 2026-09-28; the plan is built, see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** client-owned tools from plan 02 are the client's to run; asking about them is still ahpd's, before the call goes out to the client.

## Final verification checklist

- [ ] A call the policy asks about is `pending-confirmation`, the session is `InputNeeded`, and approving runs it while declining blocks it with a reason.
- [ ] Two calls waiting at once are answered independently.
- [ ] A cancelled turn releases what was waiting.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm wire` green.
- [ ] `plans/index.md` updated.
