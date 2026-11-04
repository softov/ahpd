---
title: A background task's end is a system notification
created: 2026-11-04
refs:
  - git://16bf971c - the commit of this repository the facts were checked at
  - "[code://packages/agent-claude/src/session/parts.ts#L227-L243](../../packages/agent-claude/src/session/parts.ts#L227-L243) - `openTurn`, which opens a turn the CLI started with `{ text: '', origin: { kind: 'agent' } }`"
  - "[code://packages/agent-claude/src/transcript.ts#L405-L443](../../packages/agent-claude/src/transcript.ts#L405-L443) - the restore, which makes every user frame not marked `isQueuedCommand` a prompt of origin `user`"
  - "[code://packages/sdk/src/host/localturns.ts#L28-L33](../../packages/sdk/src/host/localturns.ts#L28-L33) - the record of the turns a chat began; `transcriptOf` reads a turn without one inside the turn before it"
  - "[code://packages/sdk/src/host/wakes.ts#L115-L120](../../packages/sdk/src/host/wakes.ts#L115-L120) - the end of ahpd's own async command, already a `systemNotification` since #217"
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/claude/claudeSubagentSignals.ts#L114 - VS Code reads `task_notification` to end a background subagent
---

# A background task's end is a system notification

Softov wants the turn that a background task's end starts to look the same live and after a restart.
It is the host's notice, so it should be one muted line, as #217 made the end of ahpd's own async command.
Today a Claude session draws it two ways, and neither is a notice.
Softov saw this on 2026-11-04, after an agent ran Claude Code's Bash with `run_in_background`.

## What others do

- The protocol's `MessageKind` has `systemNotification` for a message the system made.
- VS Code at `171e90619c7` reads `task_notification` to end a background subagent.
- How VS Code draws the turn the CLI starts after a task ends was not found: searched `task-notification` and `task_notification` in `src/vs/platform/agentHost/node/claude/`.

## What ahpd has today

- When a background task ends, the Claude CLI starts a turn of its own with a `<task-notification>` prompt.
- Live, ahpd gets no prompt for that turn. `openTurn` opens it with `{ text: '', origin: { kind: 'agent' } }`, so the chat shows a second turn with an empty message.
- The CLI saves the prompt as a `user` frame with `origin: { kind: "task-notification", producer: "session-task" }` and the notification as its text. The frame has no `isQueuedCommand`.
- After a restart, the restore makes that frame a turn with origin `user` and the notification as its text.
- `transcriptOf` then reads that turn inside the turn before it, because the chat has no record that it began. The chat shows one turn, with the notification as a quoted step.
- The end of ahpd's own async command goes through `beginWakeTurn`, and is a `systemNotification` since #217.

## Who writes

- `host/20261104-0726-a-taken-steer-shows-in-its-turn` is built. Its task 03 made the fold in `localturns.ts` add a `systemNotification` part, which is the quoted step a restored chat shows.
- No open branch on `origin` changes `parts.ts`, `transcript.ts` or `localturns.ts`.

## The change

- A turn the CLI starts on a task notification is a turn of its own, live and after a restart.
- Its message has origin `systemNotification`, and the notification as its text.
- Live, the text comes from the CLI's `task_notification` frame or its prompt, so the message is not empty.
- The restore reads a frame with origin `task-notification` as that turn, not as a prompt of origin `user`.
- The host records that the turn began, so `transcriptOf` does not fold it into the turn before.

## Open points

- Which text the live turn shows: the CLI's full `<task-notification>` prompt, or a line built from `summary` and `status`.
- Whether the fold's `systemNotification` part stays for a task notification, or the turn stays out of the fold.
