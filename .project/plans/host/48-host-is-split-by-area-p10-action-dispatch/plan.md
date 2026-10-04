---
title: Action dispatch is split by family
domain: host
status: planned
priority: high
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/48-host-is-split-by-area-p9-the-method-table/plan.md
refs:
  - "[code://packages/sdk/src/host.ts#L9876-L10395](../../../../packages/sdk/src/host.ts#L9876-L10395) - `applyDispatch` from its start to the terminal branch: the family check, the dispatch gate, the relayed watch, `IS_CLIENT_DISPATCHABLE`, annotations, `root/configChanged`, changesets, automations, the session flags, `session/activeClientSet`, terminals"
  - "[code://packages/sdk/src/host.ts#L10396-L11478](../../../../packages/sdk/src/host.ts#L10396-L11478) - the rest: a worker's chat, a session not running (`session/configChanged`, `chat/turnStarted`, `chat/draftChanged`), and the switch on a chat or session action"
  - "[code://packages/sdk/src/host.ts#L9825-L9875](../../../../packages/sdk/src/host.ts#L9825-L9875) - `waiting`, `bounded`, `applyNow`, `behind`: the ordering of one connection's dispatches, which stays in `accept`"
  - "[code://packages/sdk/src/host.ts#L584](../../../../packages/sdk/src/host.ts#L584) - `dispatchable`, read by `applyDispatch` only"
---

## Goal

What a client's dispatched action does is read in two files: the checks and the host-wide families in one, a session's and a chat's actions in the other.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -nE "^        if \(|^          case '" packages/sdk/src/host.ts` past 9876 - the branches by family, and the 25 `case` labels of the switch.
- `applyDispatch` reads `connection`, `tokensFor`, `alive`, `no` (its own `refuse` wrapper), and almost every factory.
- Open plans that cite the code this child moves: host/31 (`session/configChanged`, the one `kept.setConfig`), host/44 p2 (`automation/createRequested`), host/44 p3 (the session flags, the `not served yet` default), host/45 (`root/configChanged`), host/46 (the dispatch gate), container/04 (a turn on a session not running, the held-session lookup), container/05 p9 (`chat/truncated`), claude/09 (`chat/turnStarted`).

### Gaps

- The branches `return` out of `applyDispatch`, so the one seam into `host/chatactions.ts` is `return chatAction(...)`.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| `applyDispatch` moves whole to `host/actions.ts`, and the part from the worker check to the end of the switch becomes one function in `host/chatactions.ts`, called at one seam | Softov, 2026-10-03, asked "applyDispatch is 1,600 lines of branches. How is it split?": "Two files" | 01, 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - applyDispatch is one file](task-01-actions.md) | todo | - |
| [02 - A session's and a chat's actions are one file](task-02-chat-actions.md) | todo | 01 |

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-actions.md](task-01-actions.md).
- **Open questions:** none of its own.
- **Watch out for:** `const session = held;` and the `if (!session)` refusal sit just before the switch; they go with the switch, and `held`, `holding`, `owning` and `worker` are computed inside the moved function, not passed in.

## Final verification checklist

- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass; `test/host.test.ts`, `test/conformance.test.ts`, `test/presence.test.ts`, `test/root-config.test.ts`, `test/subagent-chat.test.ts` cover this area.
- [ ] `wc -l packages/sdk/src/host.ts` recorded in `implemented.md`, under 2,000.
- [ ] `plans/index.md` updated.
