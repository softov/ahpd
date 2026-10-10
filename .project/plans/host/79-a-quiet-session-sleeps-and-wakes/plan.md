---
title: A quiet session sleeps, and wakes when something needs it
domain: host
status: planned
priority: high
created: 2026-10-10
revalidated: 2026-10-10
requires:
  - plans/host/71-an-automation-wakes-on-what-a-session-does/plan.md
refs:
  - "[code://packages/sdk/src/host.ts#L247](../../../../packages/sdk/src/host.ts#L247) - `sessions`, the live sessions; a sleeping session leaves this map and stays in the catalogue"
  - "[code://packages/sdk/src/host/state.ts#L12-L41](../../../../packages/sdk/src/host/state.ts#L12-L41) - `Held`, which has no last-activity time today"
  - "[code://packages/sdk/src/host/lifecycle.ts#L538-L700](../../../../packages/sdk/src/host/lifecycle.ts#L538-L700) - `restart`, the close-and-resume path sleep follows: `chat.close(false)`, then `sessions.delete`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L143-L316](../../../../packages/sdk/src/host/lifecycle.ts#L143-L316) - `teardown`, which sleep must not use: it kills terminals, removes subagents, ends rule state and cancels automation runs"
  - "[code://packages/sdk/src/host/chatactions.ts#L298-L450](../../../../packages/sdk/src/host/chatactions.ts#L298-L450) - the lazy resume on `chat/turnStarted` for a session that is not live, which becomes `wake`"
  - "[code://packages/sdk/src/host/catalogue.ts#L157-L172](../../../../packages/sdk/src/host/catalogue.ts#L157-L172) - `running`, a chat or a worker in progress"
  - "[code://packages/sdk/src/host/automations.ts#L324-L328](../../../../packages/sdk/src/host/automations.ts#L324-L328) - `pinnedChat`, which answers a pin only while the session is live"
  - "[code://packages/sdk/src/host/automations.ts#L703-L778](../../../../packages/sdk/src/host/automations.ts#L703-L778) - `beginAutomation`, which reads `sessions.get(pin)`"
  - "[code://packages/sdk/src/host/sessionevents.ts#L255-L310](../../../../packages/sdk/src/host/sessionevents.ts#L255-L310) - `childFinished`, delivered only while the parent is live"
  - "[code://packages/sdk/src/types/session.ts#L308](../../../../packages/sdk/src/types/session.ts#L308) - `resumable?()`, false for a nested session and for an ACP server without `loadSession`"
  - "[code://packages/sdk/src/types/session.ts#L662](../../../../packages/sdk/src/types/session.ts#L662) - `close(removing?)`; `false` keeps the backend's conversation"
  - "[code://packages/sdk/src/scheduled.ts](../../../../packages/sdk/src/scheduled.ts) - the schedule clock with an injectable timer, the pattern the wake clock mirrors"
  - "[code://packages/sdk/src/tools/session.ts#L567](../../../../packages/sdk/src/tools/session.ts#L567) - `send_message`, the pattern for a host tool an agent calls"
  - "[code://packages/agent-claude/src/session/workers.ts#L146-L167](../../../../packages/agent-claude/src/session/workers.ts#L146-L167) - `background`, `taskInfo` and `live`, claude's background work"
  - "[code://packages/agent-claude/src/session/query.ts#L249](../../../../packages/agent-claude/src/session/query.ts#L249) - the `hooks` option, where a `Stop` hook is added"
  - "[code://packages/agent-acp/src/connection.ts#L106-L120](../../../../packages/agent-acp/src/connection.ts#L106-L120) - the ACP server process, held between turns"
  - "[code://packages/sdk/src/nested.ts#L1107-L1160](../../../../packages/sdk/src/nested.ts#L1107-L1160) - a nested session's `close`, an inner ahpd process"
  - https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/agentSessionResidency.ts - VS Code's `AgentSessionResidency`: at most 10 loaded sessions, the least recently used released first, an archived one at once
  - https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/claude/claudeAgent.ts - `_releaseChat`, which stops an idle claude process and keeps its conversation
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278 - `StopHookInput.session_crons` and `background_tasks`, what a claude session will still do later
---

## Goal

A live session holds an agent process, or the agent's memory, between turns.
After a quiet time, 30 minutes by default, the host lets the agent go and the session sleeps.
The host also keeps at most 10 sessions loaded, as VS Code does, and the least recently used one sleeps first.
An archived session sleeps at once.
A sleeping session keeps its transcript, its chats, its automations, its rule state and its terminals.
It wakes when something needs it: a prompt, a pinned automation, a child's event, or a wake the agent asked for.
A session with work in hand never sleeps, and neither does a session a client has open.
Work in hand is a running or queued turn, a pending approval or question, background work, or an agent timer.
On 2026-10-10 the daemon held 21 idle `claude` processes, about 4.5 GB, and the machine ran out of swap.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -i "idle|hibernat|evict|sleep|wake" .project/plans/index.md .project/decisions` - nothing closes a quiet session or caps live processes.
- `rg "ScheduleWakeup|CronCreate|wakeup" packages` - no agent schedules its own wake through the host today.
- `rg "session_crons|background_tasks" node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` - the `Stop` and `SessionEnd` hook inputs list the CLI's own timers and background work.

### Runtime path

```
sweep (each minute, and on each turn start) -> quiet for sleepAfter, over the count limit, or archived; and nothing in hand -> chat.close(false) per chat -> sessions.delete -> root/activeSessionsChanged
prompt | pinned automation | childFinished | wake due -> wake(uri) -> spawn with resume -> session/ready -> the turn
agent -> schedule_wakeup tool -> chat record -> wake clock -> wake(uri) -> a turn with the prompt
```

### Gaps

- `Held` has no last-activity time, and the host has no idle timer.
- The lazy resume lives inside `chat/turnStarted` only; an automation and a child's event do not wake a session.
- A backend cannot say that it has work the host cannot see, such as claude's background tasks and CLI timers.
- `Not found: a host tool that schedules a wake - searched "wake", "schedule" in packages/sdk/src/tools`.

## Decisions locked in

No decision files yet.

| What | Source | Task |
| --- | --- | --- |
| The timeout closes the agent of any backend, not only claude: each one holds a process or its memory | Softov, 2026-10-10: "not just claude, any agent that does the same need that right?" | 01 |
| Quiet means no activity for a time, not a status: a session with a pending approval, background work or a turn in progress does not sleep | Softov, 2026-10-10: "do not close ones with pending approval, pending background tasks or active work? its idle in the sense of no activity in certain time, but it is active." | 01, 03 |
| The timeout is on by default at 30 minutes, and 0 turns it off | Softov, 2026-10-10, asked "How should the idle timeout be set by default?": "On, 30 minutes" | 01 |
| A count limit and the timeout both apply: at most 10 sessions are loaded, and the least recently used sleeps first | Softov, 2026-10-10, asked "What should make ahpd close a session's agent?": "Both" | 01 |
| A session that a client is subscribed to does not sleep, as in VS Code | Softov, 2026-10-10, asked "Should a client that is subscribed to a session keep it open?": "Yes, like VS Code" | 01 |
| An archived session sleeps at once, as in VS Code | Softov, 2026-10-10, asked "Should archiving a session close its agent at once?": "Yes, like VS Code" | 01 |
| A sleeping session wakes for a prompt, a pinned automation and a child's event | Softov, 2026-10-10: "It also could be used to trigger wakes right?" | 02 |
| An agent can schedule its own wake through a host tool, in this plan | Softov, 2026-10-10, asked "How far should this plan go with wakes?": "Both in this plan" | 04 |
| The claude CLI keeps its own timer tools, and a pending CLI timer keeps the session awake | Softov, 2026-10-10, asked what a claude session does with `CronCreate` and `ScheduleWakeup`: "Keep them, block sleep" | 03 |
| Sleep follows `restart`'s path, `close(false)` and `sessions.delete`, and never `teardown` | (defaulted: `teardown` kills terminals, removes subagents, ends rule state and cancels automation runs, which a sleep must keep) | 01 |
| A session whose `resumable()` answers `false` never sleeps | (defaulted: closing it loses the conversation) | 01 |
| The count limit is the option `sessionResidencyLimit`, VS Code's name, and 0 turns it off | (defaulted: the same name as upstream, and 0 means off as for `sleepAfterMinutes`) | 01 |
| One sweep each minute checks every live session | (defaulted: one timer, and a minute is fine against a 30-minute timeout) | 01 |
| A chat holds one host wake at a time; a new one replaces it, and `stop: true` cancels it | (defaulted: the shape of claude's `ScheduleWakeup`) | 04 |
| A host wake is stored in the chat's catalogue record, so it survives sleep and a daemon restart | (defaulted: the wake must outlive the process that asked for it) | 04 |
| A host wake does not keep a session awake | (defaulted: the host holds the time, so the session can sleep until it fires) | 04 |

## Proposed architecture

- **State flow** - `Held` gains `quietSince`, set at spawn and on every action the session emits or receives. A sleeping session is a catalogue row that is not in `sessions`, the same as a session after a daemon restart.
- **Data flow** - `wake(uri, chat?)` is the one way a session that is not live comes back. It is lifted from the `chat/turnStarted` path and called by every waker.
- **Event flow** - a sleep and a wake each move `root/activeSessionsChanged`. Rule state, measured windows and automation runs are not touched by a sleep.
- **Layer responsibilities** - sdk host: the sweep, `sleep`, `wake`, the wake clock and the `schedule_wakeup` tool · sdk types: `Session.busy?()` · agent-claude: `busy()` from background tasks and CLI timers · agent-acp: `busy()` from its terminals · server: the `sleepAfterMinutes` and `sessionResidencyLimit` options.
- **Source-of-truth files** - [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts), [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A quiet session sleeps](task-01-a-quiet-session-sleeps.md) | todo | - |
| [02 - A sleeping session wakes when something needs it](task-02-a-sleeping-session-wakes.md) | todo | 01 |
| [03 - A backend says what keeps it awake](task-03-a-backend-says-what-keeps-it-awake.md) | todo | 01 |
| [04 - An agent schedules its own wake](task-04-an-agent-schedules-its-own-wake.md) | todo | 02 |
| [05 - Docs](task-05-docs.md) | todo | 02, 03, 04 |

## Risks and tradeoffs

- A wake resumes the agent, which costs a process start and a transcript read. claude is a few seconds; the 30-minute default keeps this rare.
- claude's close denies a pending permission and acp's cancels one. A pending approval keeps the session awake, so no approval is lost to a sleep.
- A claude session has two wake tools, the CLI's `ScheduleWakeup` and the host's `schedule_wakeup`. The host tool's description says that it survives sleep and a restart, and a CLI timer keeps the session awake, so both work.
- A CLI timer is read from the `Stop` hook at the end of a turn. A timer that fires and is spent clears at the next `Stop`, so a session can stay awake one turn longer than it needs to.
- pi and cofold run in the daemon. Their sleep frees memory only, and their children, such as a bash tool's shell, are not waited on, as in daemon/13.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-quiet-session-sleeps.md](task-01-a-quiet-session-sleeps.md).
- **Open questions:** none.
- **Watch out for:** `teardown` and `Host.close` call `chat.close()` with no argument, which disposes a nested session's inner transcript; sleep passes `false`, as `restart` does. `pinnedChat`, `beginIn` and `childFinished` read `sessions` and must read the catalogue for a sleeping session. A turn that a wake begins is an ordinary turn, so it moves `quietSince` and the session stays awake for the next timeout.

## Final verification checklist

- [ ] With `sleepAfterMinutes: 1`, an idle claude session's process exits within two minutes, and a prompt to it answers with the earlier conversation.
- [ ] A session with a pending approval, a running background task, a CLI timer or a subscribed client is still live after the timeout.
- [ ] With `sessionResidencyLimit: 2`, a third session that starts a turn makes the least recently used quiet one sleep.
- [ ] Archiving a session closes its agent at once.
- [ ] A pinned automation and a child's `childFinished` each wake a sleeping session in place, and make no new session.
- [ ] A `schedule_wakeup` survives a daemon restart and begins its turn when due.
- [ ] `pnpm typecheck`, `pnpm boundary`, `npx vitest run` pass.
- [ ] `plans/index.md` updated.
