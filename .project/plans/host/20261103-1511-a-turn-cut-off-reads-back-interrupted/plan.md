---
title: A turn cut off reads back interrupted
domain: host
status: built
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://fa9afa9a - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L7987-L7990 - the Copilot agent hands its history reader the error of an interrupted turn: `executionInterrupted`, \"The agent was interrupted before this request finished.\""
  - "https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L1128-L1130 - after its events the reader adds that error as a resumable part and ends the last turn in error while its root request is still active"
  - "https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L1118-L1120 - a root request stops being active only at `session.idle`"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/state/sessionState.ts#L129-L134 - `createErrorResponsePart` marks the part resumable"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L2408-L2433 - VS Code shows an `executionInterrupted` error as a warning, with a Keep Going button that resumes the turn when the part is resumable"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L354 - `chat/turnResume` takes the latest errored turn whose final error part is resumable"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L199-L208 - a call still open when its turn ends is cancelled as skipped"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L492-L514 - VS Code's Claude reader ends the last turn cancelled with a call open, and complete otherwise"
  - "[code://packages/agent-pi/src/replay.ts#L92-L233](../../../../packages/agent-pi/src/replay.ts#L92-L233) - `replayEntries`, which reads pi's file into turns"
  - "[code://packages/agent-pi/src/backend.ts#L246-L261](../../../../packages/agent-pi/src/backend.ts#L246-L261) - `failedReply`, which reads only a failed reply, one an earlier resume dropped included"
  - "[code://packages/agent-pi/src/backend.ts#L484-L493](../../../../packages/agent-pi/src/backend.ts#L484-L493) - `resume`, which continues only from what `failedReply` finds"
  - "[code://packages/agent-acp/src/transcript.ts#L127-L172](../../../../packages/agent-acp/src/transcript.ts#L127-L172) - `replayedTurns`, which splits an ACP server's replay into turns"
  - "[code://packages/agent-claude/src/transcript.ts#L563-L594](../../../../packages/agent-claude/src/transcript.ts#L563-L594) - Claude's reader, which ends a turn with a call open cancelled"
---

## Goal

A pi or ACP transcript that ends while its last turn's request still ran reads that turn back interrupted, as VS Code reads its own.
The turn ends in error with VS Code's `executionInterrupted` error, "The agent was interrupted before this request finished."
The error is resumable where ahpd can resume the turn, so a VS Code client shows its Keep Going button.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `interruptedTurnError` and `executionInterrupted` in VS Code at `a4e689ae` and `3a24213`.
- The readers of pi's file, of an ACP server's replay and of a Claude transcript, for how each ends a turn cut off.
- `resume` in `packages/agent-pi` and `packages/agent-acp`.
- pi's `Agent.continue`, which runs the model from a prompt or a tool's result and refuses an answer as the last message.

### What VS Code does

- The Copilot reader ends the last turn in error with a resumable `executionInterrupted` part while its root request is still active.
- That holds whatever the last event was: a call still open, or every tool returned and nothing after.
- The parts before the error stay as the events made them, a call still open cancelled as skipped.
- The Claude reader ends the last turn cancelled with a call open, and complete otherwise.

### What ahpd does

- pi's reader ends a turn with a call that has no result cancelled, and a turn whose request ran on after every result complete.
- ACP's reader does the same with a replay.
- pi resumes a turn only from a failed reply, and ACP has no turn resume.
- Claude's reader already reads as VS Code's Claude reader does.

### Runtime path

```
pi's file -> replayEntries -> the last turn, its request still running -> error, executionInterrupted, resumable
ACP's replay -> replayedTurns -> turnsOf -> the last turn, its request still running -> error, executionInterrupted
chat/turnResume -> pi's resume -> backend.resume -> the model asked again from where the file ends
```

### Gaps

- A turn cut off reads back cancelled or complete, and a VS Code client offers nothing to go on with.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The last turn of a transcript that ends while the turn's request still runs reads back in error, with a part `executionInterrupted`, "The agent was interrupted before this request finished." | [copilotAgent.ts#L7987-L7990](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L7987-L7990); [mapSessionEvents.ts#L1128-L1130](https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L1128-L1130) | 01 |
| The parts before the error stay, a call still open cancelled as skipped | [reducer.ts#L199-L208](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L199-L208) | 01 |
| pi's request still runs when the turn's last answer asked for tools, or the turn has no answer | pi's answer `stopReason`: `toolUse` goes on to the tools, and `stop`, `length`, `error` and `aborted` end the request | 01 |
| An ACP turn's request still runs when a call is still open, or no message of the agent follows its last call | the reader's own split, with no idle in an ACP replay | 01 |
| pi's error is resumable, and a resume asks the model again from where the file ends, an answer cut off while it asked for tools taken out of its context first | [sessionState.ts#L129-L134](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/state/sessionState.ts#L129-L134); pi's `Agent.continue`, and the failed reply's resume in [backend.ts#L484-L493](../../../../packages/agent-pi/src/backend.ts#L484-L493) | 01 |
| `resumePoint` takes the place of `failedReply`, and keeps its case of a failed reply an earlier resume already dropped | one reading for every resume: [backend.ts#L246-L261](../../../../packages/agent-pi/src/backend.ts#L246-L261) | 01 |
| ACP's error is not resumable, since ahpd has no turn resume for an ACP server | the spec's `resumable`, which "indicates whether the turn can be resumed" (types/channels-chat/actions.ts L499-L500 at v1.0.0); agent-acp's `Session` has no `resume` | 01 |
| Claude's reader stays as it is, as VS Code's Claude reader reads | [claudeReplayMapper.ts#L492-L514](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L492-L514) | 01 |

## Proposed architecture

- **State flow** - each reader marks its last turn interrupted from what its transcript holds, and the error part goes after its other parts.
- **Layer responsibilities** - agent-pi: `replayEntries` and `resumePoint`, which `resume` reads.
  agent-acp: `replayedTurns` marks the turn, and `turnsOf` adds the part.
- **Source-of-truth files** - [`code://packages/agent-pi/src/replay.ts`](../../../../packages/agent-pi/src/replay.ts), [`code://packages/agent-acp/src/transcript.ts`](../../../../packages/agent-acp/src/transcript.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A cut-off turn reads back interrupted](task-01-a-cut-off-turn-reads-back-interrupted.md) | done | - |

## Risks and tradeoffs

- An ACP replay says no idle, so a turn whose last word is the agent's message reads complete, cut off or not.
- pi resumes an answer cut off while it asked for tools by asking the model again, so the model may ask for the same tools.

## Resume state

- **Done so far:** task 01, 2026-11-03.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** an earlier turn cut off and followed by another, which keeps the reading it had.

## Final verification checklist

- [x] Each new case fails on `fa9afa9a`'s sources and passes after the change.
- [x] The test files that hold the cases pass, one file at a time.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
