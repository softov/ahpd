---
title: A failed pi turn is resumed
domain: pi
status: built
priority: medium
created: 2026-10-31
revalidated: 2026-10-31
requires: []
changes: []
creates: []
refs:
  - git://a0c77b9b - the commit of ahpd this plan was checked at, and the last one that holds the brief `.project/briefs/a-failed-pi-turn-is-resumed.md`
  - git://a0c77b9b:.project/briefs/a-failed-pi-turn-is-resumed.md - the brief this plan covers
  - "[code://packages/sdk/src/host/chatactions.ts#L1081-L1090](../../../../packages/sdk/src/host/chatactions.ts#L1081-L1090) - the host's `chat/turnResume`, which calls `session.resume`"
  - "[code://packages/sdk/src/host.ts#L759-L780](../../../../packages/sdk/src/host.ts#L759-L780) - `originOf`: an action a backend emits while the client's action is applied goes out as its echo"
  - "[code://packages/sdk/src/types/session.ts#L590-L600](../../../../packages/sdk/src/types/session.ts#L590-L600) - `Session.resume`, optional and synchronous"
  - "[code://packages/agent-claude/src/session/turns.ts#L744-L780](../../../../packages/agent-claude/src/session/turns.ts#L744-L780) - the Claude backend's `resume`, the sibling to copy"
  - "[code://packages/agent-pi/src/session.ts#L657-L701](../../../../packages/agent-pi/src/session.ts#L657-L701) - `finish`, which ends a pi turn and sends `chat/error`"
  - "[code://packages/agent-pi/src/session.ts#L786-L805](../../../../packages/agent-pi/src/session.ts#L786-L805) - `agent_settled`, where a pi turn ends"
  - "[code://packages/agent-pi/src/session.ts#L979-L1104](../../../../packages/agent-pi/src/session.ts#L979-L1104) - `begin`, which opens a turn, its mapping and its watched record"
  - "[code://packages/agent-pi/src/backend.ts#L34-L102](../../../../packages/agent-pi/src/backend.ts#L34-L102) - `PiBackend`, all that a pi session may ask of pi"
  - "[code://packages/agent-pi/src/replay.ts#L99-L124](../../../../packages/agent-pi/src/replay.ts#L99-L124) - `seal`, which gives a failed turn read back from pi's file its error part"
  - "[code://packages/agent-pi/test/fake-pi.ts#L87-L150](../../../../packages/agent-pi/test/fake-pi.ts#L87-L150) - the fake `PiBackend` the suites share"
  - "[code://docs/sdk/AHP.md#L278](../../../../docs/sdk/AHP.md#L278) - ahpd's support row for `chat/turnResume`"
  - npm://@earendil-works/pi-coding-agent@1.3.0 - `AgentSession.refreshContext()`, `agent`, `sessionManager.appendContextEdit()`, and `_omitRecoveryAttempt`, pi's own retry to copy
  - npm://@earendil-works/pi-agent-core@1.3.0 - `Agent.continue()`, which needs a user or tool result message last
  - npm://@microsoft/agent-host-protocol@1.0.0 - `ErrorResponsePart.resumable` and the reducer for `chat/turnResume`
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L6053-L6094 - the Copilot session's `resume`, a send with no new message
---

## Goal

A pi turn that failed on a model call can be resumed with `chat/turnResume`, without a new message.
pi continues from the failed call, so the tool calls the turn already ran do not run again.
A turn read back from pi's file after a restart can be resumed too.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "turnResume|resume\?\(" packages/sdk/src packages/agent-*/src` - the host's case, `Session.resume`, the Claude backend and the nested session.
- `rg -n "chat/error" packages/agent-*/src` - every backend's error ending; none sets `resumable`.
- `grep -n "_startRun|_omitRecoveryAttempt|refreshContext|async continue" <pi dist>` - pi's run loop, its own retry, and `Agent.continue()`.

### Runtime path

```
chat/turnResume -> chatactions.ts -> pi session resume -> chat/turnResume echoed
  -> backend.resume: context edit on the failed reply, refreshContext, agent.continue()
  -> pi events -> heard() -> mapping -> the promise settles -> settle -> finish
```

### Gaps

- The pi session has no `resume`, so the host refuses `chat/turnResume` on every pi session.
- The pi error part has no `resumable`, so a client never offers a resume.
- `finish` sends the error part on `chat/error` but does not put it on the turn, so a snapshot has no error part.
- `PiBackend` has nothing that continues pi without a new message.
- pi raises no `agent_settled` for a run that `agent.continue()` starts outside its own loop.

## Answers

| What | Source | Task |
| --- | --- | --- |
| pi continues from the failed call: the failed reply leaves the model's context, then `agent.continue()` runs | Softov, 2026-10-31, chose "Continue from the failed call" | 02 |
| A turn read back from pi's file after a restart is resumable when it is the last turn | Softov, 2026-10-31, chose "Yes, after a restart too" | 01, 02 |
| This plan changes pi only; Claude, cofold and ACP get one plan each, from a brief that copies this logic | Softov, 2026-10-31: "one plan per agent... pi first.. brief for claude, cofold and acp copying logic" | - |
| Only a failed model call is resumable, not a failure in `begin` before the prompt | (defaulted: a failure before the prompt has no failed reply to remove from the context) | 01 |
| The pi session emits `chat/turnResume` inside `resume`, so the host sends it as the echo of the client's action | (defaulted: the host's `originOf` echoes an action emitted while the client's action is applied) | 03 |
| The resumed run ends when the promise of `agent.continue()` settles, with the checks of `agent_settled` | (defaulted: pi raises no `agent_settled` outside its own loop) | 03 |
| A resumed run that fails again ends with one more resumable error part | the protocol's *Error recovery* | 03 |
| The host's check that the last part is resumable waits for the brief of the other agents | Softov, 2026-10-31, one plan per agent | - |

## Proposed architecture

- **Data flow** - the session reopens the turn and asks the backend to continue. The backend adds a context edit that removes the failed reply, reads the context again and calls `agent.continue()`.
- **Event flow** - `chat/turnResume` goes out first. pi's events then reach `heard` and the mapping as on a live turn. The turn ends with `chat/turnComplete`, `chat/turnCancelled` or `chat/error`.
- **State flow** - the turn moves from `turns` back to `active`, with its message and parts. Its watched record goes back to the running state.
- **Layer responsibilities** - `backend.ts` talks to pi. `session.ts` owns the turn. `replay.ts` marks the last failed turn read from the file. docs: `AHP.md` and the pi README.
- **Source-of-truth files** - [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A failed model call is resumable](task-01-a-failed-model-call-is-resumable.md) | done | - |
| [02 - pi continues from the failed call](task-02-pi-continues-from-the-failed-call.md) | done | - |
| [03 - The pi session resumes the turn](task-03-the-pi-session-resumes-the-turn.md) | done | 01, 02 |

## Risks and tradeoffs

- A run that `agent.continue()` starts is outside pi's own loop. pi makes no retry and no compaction in it, and it raises no `agent_settled`.
- pi's `isStreaming` is false during that run. A steer still reaches the run, because `steer` puts the message on the agent's own queue.
- The context edit stays in pi's file. The `pi` command shows the same conversation, without the failed reply in the model's context, as after pi's own retry.
- A client that holds an error part without `resumable` from before this change shows no resume for that turn until it reads the chat again.

## Resume state

- **Done so far:** built 2026-10-31. See [implemented.md](implemented.md).
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** `maycxc/host/20261030-0559-a-late-answer-is-refused` changes `confirm` in `packages/agent-pi/src/session.ts`. The second branch to merge rebases.

## Final verification checklist

- [ ] A pi turn that fails on a model call shows a resume in VS Code, and the resume continues the turn without a new message.
- [ ] A tool call that ran before the failure does not run again.
- [ ] After a daemon restart, the last failed turn can still be resumed.
- [ ] A resume that fails again adds one more error part, and the turn can be resumed again.
- [ ] A failure before the prompt, such as an unknown model, shows no resume.
- [ ] `pnpm typecheck` and the agent-pi and sdk suites pass, and Windows CI is green.
