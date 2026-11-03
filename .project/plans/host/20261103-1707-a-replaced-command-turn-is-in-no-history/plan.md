---
title: A replaced command turn is in no history
domain: host
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://3945964a - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L358-L387 - a turn started while another is active takes its place, and the one it replaced is in no history"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1815 - VS Code's host applies a client's start and hands it on, whatever runs"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/localCommand/localCommandContribution.ts#L28-L41 - a `!` command runs as a turn of the host's own"
  - "[code://packages/agent-acp/src/session/queue.ts#L189-L194](../../../../packages/agent-acp/src/session/queue.ts#L189-L194) - `hand`, which marks the turn it takes the place of in `replaced`"
  - "[code://packages/agent-acp/src/session/turn.ts#L113-L116](../../../../packages/agent-acp/src/session/turn.ts#L113-L116) - `finish`, which keeps a replaced model turn out of the history and its failure off the chat"
  - "[code://packages/agent-cofold/src/runs.ts#L63-L65](../../../../packages/agent-cofold/src/runs.ts#L63-L65) - cofold's `settleTurn`, the same reading"
  - "[code://packages/agent-pi/src/session.ts#L747](../../../../packages/agent-pi/src/session.ts#L747) - pi's `finish`, which a command's end goes through, the same reading"
  - "[code://packages/agent-claude/src/session/turns.ts#L560-L690](../../../../packages/agent-claude/src/session/turns.ts#L560-L690) - Claude's `runCommand`, whose end returns once a handed turn took its place"
---

## Goal

A `!` command turn that a turn sent after it took the place of is in no history.
Its failure is not the chat's.
The turn that took its place runs once the command is over, in every backend.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `replaced` in `packages/agent-*/src`, `packages/bot/src` and `examples`: where each backend marks and reads a replaced turn.
- `runCommand` in the same places: where each backend ends a command's turn.
- The bot and the two examples run no `!` command.

### What the sources say

- The protocol's reducer puts a new turn in the active turn's place, and the turn it replaced is in no history.
- VS Code's host runs a `!` command as a turn of its own, and a client's start replaces it as it replaces any turn.

### What ahpd does

- ACP and cofold mark the turn a handed turn replaces, and read the mark where a model turn ends.
- Their command's end reads no mark, so the replaced command turn goes into the history the backend serves.
- ACP's command end also sets the chat's failure for a replaced command that failed.
- pi ends a command's turn through `finish`, which reads the mark.
- Claude's command end returns once a handed turn took its place, and starts nothing.
- The handed turn then waits as the chat's turn until a client changes the queue.

### Gaps

- ACP and cofold: a replaced command turn reads back after a reload, and ACP's failure marks the chat.
- Claude: a turn sent while a command runs never reaches the CLI.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A replaced command turn is in no history | [reducer.ts#L358-L387](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L358-L387) | 01 |
| A replaced command's failure is not the chat's | the reading every backend's model turn already makes, in [turn.ts#L113-L116](../../../../packages/agent-acp/src/session/turn.ts#L113-L116) | 01 |
| The turn that took the command's place begins once the command is over | ahpd's handed turns run once the work in front of them is done, as `Session.begin` says; [agentSideEffects.ts#L1810-L1815](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1815) hands every start on | 01 |

## Proposed architecture

- **State flow** - each command end reads the replaced mark as the backend's model end reads it.
- **Layer responsibilities** - agent-acp: `runCommand`'s end. agent-cofold: `runCommand`'s end. agent-claude: `runCommand`'s end starts the handed turn.
- **Source-of-truth files** - [`code://packages/agent-acp/src/session/queue.ts`](../../../../packages/agent-acp/src/session/queue.ts), [`code://packages/agent-cofold/src/turns.ts`](../../../../packages/agent-cofold/src/turns.ts), [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A replaced command's end reads the mark](task-01-a-replaced-commands-end-reads-the-mark.md) | todo | - |

## Risks and tradeoffs

- None found: each change reads a mark the backend already keeps.

## Resume state

- **Done so far:** nothing yet.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** a command a stop ended, whose end starts nothing in Claude.

## Final verification checklist

- [ ] Each new case fails on `3945964a`'s sources and passes after the change.
- [ ] The test files that hold the cases pass, one file at a time.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
