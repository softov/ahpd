---
title: A background task's end is a notice turn
domain: claude
status: planned
priority: medium
created: 2026-11-04
revalidated: 2026-11-04
requires:
  - plans/host/20261104-1150-an-automation-session-keeps-its-origin/plan.md
refs:
  - git://736aa129 - the commit of ahpd the facts were checked at
  - git://42cc7f65 - the last commit that holds the brief `a-background-task-end-is-a-system-notification`
  - "[code://packages/agent-claude/src/session/parts.ts#L227-L249](../../../../packages/agent-claude/src/session/parts.ts#L227-L249) - `openTurn`, which opens a turn the CLI started with an empty `agent` message"
  - "[code://packages/agent-claude/src/session/query.ts#L935-L947](../../../../packages/agent-claude/src/session/query.ts#L935-L947) - the live `task_notification` frame and its `summary`"
  - "[code://packages/agent-claude/src/transcript.ts#L326-L329](../../../../packages/agent-claude/src/transcript.ts#L326-L329) - the text of a restored user frame"
  - "[code://packages/agent-claude/src/transcript.ts#L436-L443](../../../../packages/agent-claude/src/transcript.ts#L436-L443) - a restored user frame becomes a turn of origin `user`"
  - "[code://packages/sdk/src/host/localturns.ts#L387-L411](../../../../packages/sdk/src/host/localturns.ts#L387-L411) - `asBegun`, which folds a turn the chat did not begin into the turn before it"
  - "[code://packages/sdk/src/host/wakes.ts#L115-L120](../../../../packages/sdk/src/host/wakes.ts#L115-L120) - the end of ahpd's own async command, a `systemNotification` turn"
  - https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/state.ts - `MessageKind`, with `systemNotification` for a message the system made
---

## Goal

The turn that a background task's end starts in a Claude session is one notice turn, live and after a restart.
Its message has origin `systemNotification` and the task's summary as its text.
ahpw then draws it as one muted line, as it draws the end of ahpd's own async command.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "task_notification" packages/agent-claude/src` - `query.ts` reads the frame only to end a worker.
- `rg -n "openTurn\(" packages/agent-claude/src` - `stream.ts` and `asking.ts` open a turn without an opening, so it gets an empty `agent` message.
- `rg -n "task-notification" packages/agent-claude` - the restore does not read the CLI's frame origin.

### Runtime path

```
live:    task_notification (no turn open) -> pending summary -> openTurn -> message { summary, systemNotification }
restore: user frame, origin.kind 'task-notification' -> turn, message { <summary>, systemNotification }
host:    asBegun -> a systemNotification turn stays a turn of its own
```

### Gaps

- Live, the turn has an empty message of origin `agent`.
- After a restart, the turn has origin `user` and the full `<task-notification>` text, and the host folds it into the turn before.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The notice text is the task's summary line, not the CLI's full prompt | Softov, 2026-11-04, "The summary line" | 01, 02 |
| The notice is a turn of its own, live and after a restart | (defaulted: the brief's change) | 01, 02, 03 |
| The host does not fold a turn whose message origin is `systemNotification` | (defaulted: the restored turn id never matches the live one, so a record cannot keep it apart) | 03 |
| Only a notification that arrives while no turn is open gives the next turn its text | (defaulted: one inside an open turn starts no turn) | 01 |
| A restored frame without a `<summary>` uses its full text | (defaulted: never an empty message) | 02 |

## Proposed architecture

- **Data flow** - the summary of a notification goes to the message of the turn that the CLI starts after it.
- **State flow** - the session keeps one pending summary, cleared when a turn opens.
- **Layer responsibilities** - agent-claude: the live turn and the restore · sdk host: no fold of a notice turn.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session/parts.ts`](../../../../packages/agent-claude/src/session/parts.ts) · [`code://packages/agent-claude/src/transcript.ts`](../../../../packages/agent-claude/src/transcript.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the live turn is a notice](task-01-the-live-turn-is-a-notice.md) | implemented | - |
| [02 - the restored turn is a notice](task-02-the-restored-turn-is-a-notice.md) | implemented | - |
| [03 - the host does not fold a notice](task-03-the-host-does-not-fold-it.md) | implemented | - |

## Risks and tradeoffs

- The live turn and the restored turn have different ids, as every turn the CLI starts has today.
- This plan builds on the branch of `host/20261104-1150-an-automation-session-keeps-its-origin`, which changes `localturns.ts` too.

## Resume state

- **Done so far:** tasks 01 and 02 are implemented. Live, the turn a background task's end wakes opens with the task's summary and origin `systemNotification`; after a restart the same frame restores the same way.
- **Next action:** [task-03-the-host-does-not-fold-it.md](task-03-the-host-does-not-fold-it.md).
- **Watch out for:** a `task_notification` also arrives for a task inside a running turn; that one starts no turn and leaves no pending summary.

## Final verification checklist

- [ ] Live, the turn after a background Bash ends has one message of origin `systemNotification` with the summary.
- [ ] After a restart, the same chat shows that turn as its own turn, with the same origin and text.
- [ ] `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass, and the sdk and agent-claude tests pass.
