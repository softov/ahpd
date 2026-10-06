---
title: What the review of host/30, host/56, daemon/13 and claude/10 found is fixed
domain: host
status: built
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/30-a-session-is-listed-under-its-providers-name/plan.md
  - plans/host/56-the-catalogue-answers-at-once-and-a-summary-is-sent-when-it-changes/plan.md
  - plans/daemon/13-ahpd-restart/plan.md
  - plans/claude/10-a-claude-session-runs-on-a-preset/plan.md
decisions:
  - decisions/a-stored-sandbox-on-survives-the-preset.md
problems:
  - problems/a-claimed-chat-is-read-as-a-session.md
  - problems/an-unreadable-session-file-is-overwritten.md
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L380-L392](../../../../packages/sdk/src/host/catalogue.ts#L380-L392) - `listing` leaves out claimed ids, so a running session is not in a refresh"
  - "[code://packages/sdk/src/host/catalogue.ts#L640-L675](../../../../packages/sdk/src/host/catalogue.ts#L640-L675) - `rowsMoved`, whose removal loop announces every row a refresh did not list"
  - "[code://packages/sdk/src/host/history.ts#L129-L181](../../../../packages/sdk/src/host/history.ts#L129-L181) - the held `rows`, which nothing removes a deleted session from"
  - "[code://packages/sdk/src/host/lifecycle.ts#L343-L373](../../../../packages/sdk/src/host/lifecycle.ts#L343-L373) - `removeSession`"
  - "[code://packages/sdk/src/host/admission.ts#L44-L52](../../../../packages/sdk/src/host/admission.ts#L44-L52) - `completions` is gated only when `channel` is a string"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L113](../../../../packages/sdk/src/host/sessionmethods.ts#L113) - one of eight handlers that read `String(params.channel ?? '')`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L160-L172](../../../../packages/sdk/src/host/sessionmethods.ts#L160-L172) - `fetchTurns` reads a session id out of any channel"
  - "[code://packages/sdk/src/host/snapshots.ts#L243](../../../../packages/sdk/src/host/snapshots.ts#L243) - `snapshotOf`'s `sessionChannel` guard, the pattern for `fetchTurns`"
  - "[code://packages/server/src/commands/run.ts#L895-L912](../../../../packages/server/src/commands/run.ts#L895-L912) - `down`, which awaits the plugins' `stopping` before closing the listeners"
  - "[code://packages/server/src/commands/restart.ts#L231-L246](../../../../packages/server/src/commands/restart.ts#L231-L246) - `checkedRestart`, the turn check"
  - "[code://packages/server/src/commands/run.ts#L951-L955](../../../../packages/server/src/commands/run.ts#L951-L955) - `optionsOfLine`, which reads the recorded line with this process's code and `permissive: true`"
  - "[code://docs/DAEMON.md#L199-L226](../../../../docs/DAEMON.md#L199-L226) - `ahpd restart`"
  - "[code://packages/agent-claude/src/session.ts#L73](../../../../packages/agent-claude/src/session.ts#L73) - a session's values: defaults and preset"
  - "[code://packages/agent-claude/src/options.ts#L46-L54](../../../../packages/agent-claude/src/options.ts#L46-L54) - `sandbox`'s query shape"
---

## Goal

The bugs the 2026-10-06 review of host/30, host/56, daemon/13 and claude/10 confirmed are fixed, each with a test that fails before the fix: a running session is never announced removed, a deleted one leaves the catalogue, a request cannot skip its gate with a non-string channel, turns are sent only for a session's channel, a restart kills no turn it did not check and leaves a daemon running when its line cannot run, and an old session with the sandbox on keeps it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.
The review's probes reproduced tasks 01, 02 and 03; their cases are the first tests to write.

### Searches performed

- `rg -n "String\(params.channel" packages/sdk/src/host` - eight handlers in `sessionmethods.ts` read a channel that way.
- `rg -n "sessionChannel" packages/sdk/src/host` - the guard `snapshotOf` uses and `fetchTurns` does not.

### Gaps

- No test covers a refresh while a listed session runs, a delete followed by a list, a non-string channel, `fetchTurns` on a terminal name, a turn started during a restart, or a resumed session with a stored `sandboxEnabled`.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A session stored with the sandbox on keeps it on, whatever its preset says](../../../decisions/a-stored-sandbox-on-survives-the-preset.md) | Softov, 2026-10-06, "Honour the stored value" |

| What | Source | Task |
| --- | --- | --- |
| Fix every bug the review confirmed, in one plan, built now | Softov, 2026-10-06, "One fix plan, built now" | all |
| A non-string `channel` is refused `-32602` before any gate or handler | `(defaulted: refusing is the one answer that cannot skip a check)` | 03 |
| A restart stops the host taking new turns before it checks the running ones | `(defaulted: a check that a turn can slip past is no check)` | 05 |
| The successor's own code checks the recorded line before the old daemon goes down | `(defaulted: only the code that will run knows its flags)` | 06 |
| The claimed-chat grant and the overwritten store file stay problems | not in the review's confirmed list; [a-claimed-chat-is-read-as-a-session](../../../problems/a-claimed-chat-is-read-as-a-session.md), [an-unreadable-session-file-is-overwritten](../../../problems/an-unreadable-session-file-is-overwritten.md) | - |

## Proposed architecture

- **Layer responsibilities** - sdk: tasks 01-04 (catalogue, history, admission, session methods) · server: 05-06 (restart) · agent-claude: 07.
- **Source-of-truth files** - [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts), [`code://packages/server/src/commands/restart.ts`](../../../../packages/server/src/commands/restart.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A running session is never announced removed](task-01-a-running-session-is-never-announced-removed.md) | done | - |
| [02 - A deleted session leaves the held catalogue](task-02-a-deleted-session-leaves-the-held-catalogue.md) | done | - |
| [03 - A channel is a string or the request is refused](task-03-a-channel-is-a-string-or-refused.md) | done | - |
| [04 - Turns are fetched only for a session's channel](task-04-turns-are-fetched-only-for-a-sessions-channel.md) | done | 03 |
| [05 - A restart takes no new turn once it has checked](task-05-a-restart-takes-no-new-turn-once-checked.md) | done | - |
| [06 - A restart checks its line with the code that will run it](task-06-a-restart-checks-its-line-with-the-code-that-will-run-it.md) | done | 05 |
| [07 - A stored sandbox on survives the preset](task-07-a-stored-sandbox-on-survives-the-preset.md) | done | - |

## Risks and tradeoffs

- Task 05 refuses turns for the length of the plugins' `stopping` handlers, which have no time limit - a client is told the daemon is restarting rather than having its turn killed.
- Task 06 adds a process spawn to every restart - a restart is rare and the spawn exits after parsing.

## Resume state

- **Done so far:** tasks 01-07 implemented 2026-10-06, each with a case that failed before the fix. Task 07 stopped on a fork - the value a store actually holds - which Softov answered on 2026-10-06: a stored `'on'` or `true`, so both the decision and the task now read that.
- **Next action:** Softov's review, which sets the tasks to `done`.
- **Open questions:** none. The one task 07 stopped on is answered and recorded in [the decision](../../../decisions/a-stored-sandbox-on-survives-the-preset.md).
- **Watch out for:** every task starts with a test that fails on `main`; a fix with no failing test first is not done.

## Final verification checklist

- [x] Each task's new case fails on `c4e4dd0` and passes after.
- [ ] `pnpm typecheck`, `pnpm boundary`, `pnpm test`, `pnpm build` pass - typecheck, boundary and build pass; `pnpm test` fails one case, `computer-parts-mount.test.ts > asks again after a probe the image failed`, a docker test timing out in a file this plan does not change, which fails the same way when run on its own. [implemented.md](implemented.md) reports it as a failure.
- [x] `plans/index.md` updated.
