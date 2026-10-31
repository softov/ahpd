---
title: A failed Claude turn is resumed
domain: claude
status: active
priority: medium
created: 2026-10-31
revalidated: 2026-10-31
requires: []
changes: []
creates: []
refs:
  - git://cb47945e - the commit of ahpd this plan was checked at, and the last one that holds the brief `.project/briefs/claude-cofold-and-acp-resume-a-failed-turn.md`
  - git://cb47945e:.project/briefs/claude-cofold-and-acp-resume-a-failed-turn.md - the brief this plan covers, with the cofold plan and the ACP idea
  - "[code://.project/plans/pi/20261031-0736-a-failed-pi-turn-is-resumed/plan.md](../../pi/20261031-0736-a-failed-pi-turn-is-resumed/plan.md) - the pi plan, the logic to copy"
  - "[code://packages/sdk/src/host/chatactions.ts#L1081-L1090](../../../../packages/sdk/src/host/chatactions.ts#L1081-L1090) - the host's `chat/turnResume`, which calls `session.resume` and does not check `resumable`"
  - "[code://packages/agent-claude/src/session/turns.ts#L752-L780](../../../../packages/agent-claude/src/session/turns.ts#L752-L780) - `resume`, which sends the turn's text to the same CLI again and emits no `chat/turnResume`"
  - "[code://packages/agent-claude/src/session/turns.ts#L135-L146](../../../../packages/agent-claude/src/session/turns.ts#L135-L146) - `again`, which sends the running turn's prompt as it first went, with its attachments"
  - "[code://packages/agent-claude/src/session/turns.ts#L155-L180](../../../../packages/agent-claude/src/session/turns.ts#L155-L180) - `refuseTurn`, a turn that never reached the CLI"
  - "[code://packages/agent-claude/src/session/logins.ts#L167-L176](../../../../packages/agent-claude/src/session/logins.ts#L167-L176) - `cutOf`, where a failed turn is cut back to"
  - "[code://packages/agent-claude/src/session/logins.ts#L256-L316](../../../../packages/agent-claude/src/session/logins.ts#L256-L316) - `moveOn`, which puts a new CLI on the cut conversation and sends the prompt again; the pattern to copy"
  - "[code://packages/agent-claude/src/session/parts.ts#L314-L339](../../../../packages/agent-claude/src/session/parts.ts#L314-L339) - `failurePart` and `addFailure`, with no `resumable`"
  - "[code://packages/agent-claude/src/session/query.ts#L295-L307](../../../../packages/agent-claude/src/session/query.ts#L295-L307) - `failTurn`, the ending of a turn whose CLI is gone"
  - "[code://packages/agent-claude/src/session/query.ts#L994-L998](../../../../packages/agent-claude/src/session/query.ts#L994-L998) - `wrong`, the failure a `result` ends a turn with"
  - "[code://packages/agent-claude/src/session/query.ts#L1087](../../../../packages/agent-claude/src/session/query.ts#L1087) - where that failure becomes the turn's error part"
  - "[code://packages/agent-claude/src/session/query.ts#L838-L841](../../../../packages/agent-claude/src/session/query.ts#L838-L841) - `ends`, the last chain entry of each turn, where a cut is made"
  - "[code://packages/agent-claude/src/transcript.ts#L51-L68](../../../../packages/agent-claude/src/transcript.ts#L51-L68) - `turnsOf`, which reads no turn back as failed"
  - "[code://packages/sdk/test/host-turn.test.ts#L830-L875](../../../../packages/sdk/test/host-turn.test.ts#L830-L875) - the host's resume cases, driven through the Claude backend"
  - "[code://docs/sdk/AHP.md#L278](../../../../docs/sdk/AHP.md#L278) - ahpd's support row for `chat/turnResume`"
  - npm://@anthropic-ai/claude-agent-sdk - `resumeSessionAt`, which `startQuery` passes to cut the conversation back
  - npm://@microsoft/agent-host-protocol@1.0.0 - `ErrorResponsePart.resumable` and the reducer for `chat/turnResume`
---

## Goal

A Claude turn that failed on a model call can be resumed with `chat/turnResume`, as a pi turn can.
The failed prompt and its reply leave the conversation, and Claude runs the prompt again.
The host refuses a resume of any turn whose last part is not a resumable error, as the protocol says.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "turnResume|resumable" packages/sdk/src packages/agent-*/src` - the host's case, the pi backend, and the Claude comment that says this host cannot resume.
- `rg -n "addFailure|failTurn\(" packages/agent-claude/src` - three endings: a `result`, a CLI that is gone, and a turn refused before the CLI.
- `rg -n "cutOf|startQuery\(" packages/agent-claude/src/session` - the cut a login move makes, which a resume can make too.
- `rg -n "error|is_error" packages/agent-claude/src/transcript.ts` - a transcript read back marks no turn failed.

### Runtime path

```
chat/turnResume -> chatactions.ts: last part is a resumable error? -> Claude session resume
  -> chat/turnResume echoed -> close the CLI -> startQuery(running, false, cut) or start over
  -> again(): the prompt to the new CLI -> stream -> result -> the turn ends as a live turn ends
```

### Gaps

- The error part has no `resumable`, so a client offers no resume and the protocol's reducer ignores one.
- `resume` sends the prompt to a CLI whose conversation still holds the failed prompt and its reply.
- `resume` emits no `chat/turnResume`, so the client's action is not echoed.
- The host calls `session.resume` without the protocol's check on the last part.

## Answers

| What | Source | Task |
| --- | --- | --- |
| One plan per agent, each copying the pi logic | Softov, 2026-10-31: "one plan per agent... pi first.. brief for claude, cofold and acp copying logic" | - |
| A resume cuts back to the end of the turn before, with `resumeSessionAt`, and sends the prompt again; a conversation's first turn starts over | Softov, 2026-10-31: "go back to the turn before the failure" | 02 |
| Only a failure a `result` reports is resumable, and only when `cutOf` finds a cut | (defaulted: a turn refused before the CLI, a CLI that is gone and a refused login have nothing to run again on) | 01 |
| A turn read back after a restart is not resumable | (defaulted: [`code://packages/agent-claude/src/transcript.ts#L51-L68`](../../../../packages/agent-claude/src/transcript.ts#L51-L68) reads no turn back as failed) | - |
| The host's check that the last part is a resumable error is in this plan | (defaulted: it breaks the host's Claude resume test until Claude marks its errors, so it goes with that change) | 03 |
| The Claude session emits `chat/turnResume` inside `resume`, so the host sends it as the echo | the pi plan's row, [`code://packages/sdk/src/host.ts#L759-L780`](../../../../packages/sdk/src/host.ts#L759-L780) | 02 |
| A resumed turn that fails again ends with one more resumable error part | the protocol's *Error recovery* | 01, 02 |
| A `result` with `is_error: true` ends the turn in `error`, also under `subtype: success` | Softov, 2026-10-31: "Save it as error" | 01 |

## Proposed architecture

- **Data flow** - `resume` reopens the turn, closes the CLI, and starts a new one on the conversation cut at the end of the turn before. `again` sends the turn's prompt and attachments to it.
- **Event flow** - `chat/turnResume` goes out first. The new CLI's stream then reaches the turn as a live turn's does, up to `chat/turnComplete`, `chat/turnCancelled` or `chat/error`.
- **State flow** - the turn moves from `turns` back to `active`, with its message and parts. Its entry in `ends` goes with the cut.
- **Layer responsibilities** - agent-claude: `parts.ts` marks the part, and `query.ts` decides if a failure is resumable. `turns.ts` and `logins.ts` resume. sdk: `chatactions.ts` checks the last part. docs: `AHP.md`.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A failed model call is resumable](task-01-a-failed-model-call-is-resumable.md) | implemented | - |
| [02 - Resume cuts back and runs again](task-02-resume-cuts-back-and-runs-again.md) | implemented | 01 |
| [03 - The host checks the last part](task-03-the-host-checks-the-last-part.md) | implemented | 01 |

## Risks and tradeoffs

- The failed turn's tool calls run again, because the cut drops them with the failed prompt.
- pi keeps them; Claude has no call that continues without a new message.
- A resume closes the CLI and starts a new one, which takes a few seconds before the first token.
- A client that holds an error part from before this change shows no resume for that turn until it reads the chat again.

## Resume state

- **Done so far:** the three tasks are built on `build/agents/ec2bea86`. [implemented.md](implemented.md) says what exists now.
- **Next action:** the hand checks of [task 02](task-02-resume-cuts-back-and-runs-again.md), with a test ahpd, a bad key and a resume from VS Code. Then a review.
- **Open questions:** none.
- **Watch out for:** the cofold plan and the push build do not touch these files. Check `git log origin/main -- packages/agent-claude/src/session` before a later change here.

## Final verification checklist

- [ ] A Claude turn that fails on a model call shows a resume in VS Code.
- [ ] The resume runs the prompt again on a cut conversation.
- [ ] A resume of a conversation's first turn starts over under its id.
- [ ] A resume that fails again adds one more error part, and the turn can be resumed again.
- [ ] A turn refused before the CLI shows no resume, and the host refuses `chat/turnResume` on it.
- [ ] `pnpm typecheck`, the agent-claude and sdk suites pass, and Windows CI is green.
