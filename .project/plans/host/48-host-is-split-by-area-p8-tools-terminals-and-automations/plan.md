---
title: Session tools, terminals and automations are files of their own
domain: host
status: planned
priority: high
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/48-host-is-split-by-area-p7-session-lifecycle/plan.md
refs:
  - "[code://packages/sdk/src/host.ts#L5879-L6222](../../../../packages/sdk/src/host.ts#L5879-L6222) - `permitted` to `instructions`: the tools and titles a session is offered, and what a host tool sees"
  - "[code://packages/sdk/src/host.ts#L5724-L5878](../../../../packages/sdk/src/host.ts#L5724-L5878) - `commanded`, `terminalInfo`, `heldTerminals`"
  - "[code://packages/sdk/src/host.ts#L586-L613](../../../../packages/sdk/src/host.ts#L586-L613) - `claimOf`, a terminal claim read off a request"
  - "[code://packages/sdk/src/host.ts#L988-L1018](../../../../packages/sdk/src/host.ts#L988-L1018) - `origins`, `linked`, `settleRun`"
  - "[code://packages/sdk/src/host.ts#L2607-L2652](../../../../packages/sdk/src/host.ts#L2607-L2652) - the `onChanged` callback, registered at construction"
  - "[code://packages/sdk/src/host.ts#L7168-L7295](../../../../packages/sdk/src/host.ts#L7168-L7295) - `beginAutomation`, `startForAutomation`, and the `onDue` callback registered at construction"
  - "[code://packages/sdk/src/host.ts#L7308-L7311](../../../../packages/sdk/src/host.ts#L7308-L7311) - `Host.setTools`, which writes `contributed` and `contributing`"
  - "[code://packages/sdk/src/host.ts#L10168-L10171](../../../../packages/sdk/src/host.ts#L10168-L10171) - the `root/configChanged` branch, which writes `advancedTools`"
---

## Goal

What a session's model is offered and what a host tool can see, the host's terminals, and the automation runtime are three files.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `advancedTools`, `contributed` and `contributing` are `let`s; `contributed` and `contributing` are written by `Host.setTools`, `advancedTools` by the `root/configChanged` branch.
- `claimOf` is read by `createTerminal` and by the `terminal/*` dispatch branch, both still in `accept`; `host.ts` imports it from `host/terminals.ts`.
- Open plans that cite the code this child moves: host/33 (`toolContext`), host/45 (`compactPrompts`, `strategies`, `strategyOf`, `shapedDefinition`, `instructions`), host/44 p2 (`onDue`).

### Gaps

- The terminal and automation methods and dispatch branches stay in `accept` until p9 and p10.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Every factory takes the `HostContext`, and adds its area's fields to `host/context.ts` | the parent's second table, Softov's "One HostContext" | 01, 02, 03 |
| `advancedTools`, `contributed` and `contributing` become fields on the context, and their writers outside the moved code write `ctx.<name>` | Softov, 2026-10-03: "One HostContext", in the parent's second table | 01 |
| The `onChanged` and `onDue` registrations stay in `host.ts` at the same point of construction, handed the function the factory offers | the parent's *Gaps* | 03 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The tools and titles a session is offered are one file](task-01-tooling.md) | todo | - |
| [02 - The host's terminals are one file](task-02-terminals.md) | todo | - |
| [03 - The automation runtime is one file](task-03-automations.md) | todo | - |

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-tooling.md](task-01-tooling.md).
- **Open questions:** none of its own.
- **Watch out for:** `toolContext` builds the `ToolCall` every host tool is handed; its object literal moves unchanged.

## Final verification checklist

- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass; `test/sessiontools.test.ts`, `test/artifacttools.test.ts`, `test/toolserver.test.ts`, `test/toolauth.test.ts`, `test/toolpolicy.test.ts`, `test/pty.test.ts`, `test/automations.test.ts` and `test/scheduled.test.ts` cover this area.
- [ ] `wc -l packages/sdk/src/host.ts` recorded in `implemented.md`, about 730 lines fewer than before.
- [ ] `plans/index.md` updated.
