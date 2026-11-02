---
title: A state read back reaches its clients whole
domain: host
status: built
priority: high
created: 2026-11-01
revalidated: 2026-11-01
requires:
  - plans/host/20261101-0329-the-hosts-state-is-the-reducers-output/plan.md
  - plans/host/20261101-1357-backends-say-their-state-by-actions/plan.md
  - plans/host/20261101-1357-a-case-starts-from-its-initial/plan.md
refs:
  - git://b7a08801 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentService.ts#L14664-L14675 - a restore reads a session's turns through its agent"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentService.ts#L14758-L14765 - and seeds the restored state with them"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/protocolServerHandler.ts#L690-L701 - a client holding no baseline from this process's state is owed one"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1374-L1379 - a reconnect owing a baseline is answered with snapshots"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/localCommands/localChatCommand.ts#L229-L247 - a local turn is recorded from the state its clients were served"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/localCommands/localChatCommand.ts#L250-L275 - a kept local turn drops its live terminal, which a reload ends"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L389-L417 - a replayed call opens cancelled as skipped until its result lands"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L492-L514 - a replayed turn closes cancelled while a call has no result, and complete otherwise"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L172-L210 - the reducer cancels a call still open when its turn ends, as skipped"
  - "[code://packages/sdk/src/host/handshake.ts#L491-L628](../../../../packages/sdk/src/host/handshake.ts#L491-L628) - a reconnect, which replays whenever the gap fits the buffer"
  - "[code://packages/sdk/src/host.ts#L1157-L1172](../../../../packages/sdk/src/host.ts#L1157-L1172) - a session not running lets its states go once nobody watches them"
  - "[code://packages/sdk/src/host/spawn.ts#L1467-L1473](../../../../packages/sdk/src/host/spawn.ts#L1467-L1473) - a command's turn is kept from the backend's record"
  - "[code://packages/agent-claude/src/transcript.ts#L494-L523](../../../../packages/agent-claude/src/transcript.ts#L494-L523) - a Claude call is read back completed and successful when no result says otherwise"
  - "[code://packages/agent-pi/src/replay.ts#L95-L117](../../../../packages/agent-pi/src/replay.ts#L95-L117) - a pi turn is read back with its last answer's usage, and a call with no result running"
  - "[code://packages/agent-acp/src/transcript.ts#L48-L132](../../../../packages/agent-acp/src/transcript.ts#L48-L132) - an ACP replay reads every turn complete, and a call with no end running"
  - "[code://packages/bot/src/chat.ts#L789-L796](../../../../packages/bot/src/chat.ts#L789-L796) - the bot writes a turn's begun line with no parts"
---

## Goal

A state this host reads back from a record is the state every client of it holds.
A client whose state came from an earlier opening of a channel is sent the state, not replayed onto it.
What the host records of its own turns is the turn its clients reduced.
A turn read back ends the way the reference reads a turn back.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.
The audit rows are CS20, Q24, B10 and P8, which the backends' plan's [deferred.md](../20261101-1357-backends-say-their-state-by-actions/deferred.md) lists.

### Searches performed

- `rg -n "statesUnwatched" packages/sdk/src` - a sleeping session's states go once nobody watches them.
- `rg -n "replayable_" packages/sdk/src/host/handshake.ts` - a reconnect replays whenever the gap fits the buffer.
- `rg -n "keepLocalTurn" packages/sdk/src` - a command's turn is kept from `allTurns()`.
- `rg -n "state: 'complete'" packages/*/src` - the backends that read a turn back complete.

### Runtime path

```
a session asleep, unwatched -> its states go -> a client reconnects
  -> the state opens again from the record -> the actions since are replayed onto the client's old state
```

### Gaps

- A client back from a drop is replayed onto a state the host no longer holds, when the session's states went meanwhile.
- A command's turn is kept as the backend recorded it, which can differ from the turn clients reduced.
- A Claude call with no result reads back completed and successful, and its turn complete.
- A pi turn reads back its last answer's usage, while the live turn said every answer's.
- A pi or ACP call with no end reads back running in a finished turn.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A restore reads a session's turns through its agent and seeds the state with them; nothing writes the held state down | [agentService.ts#L14664-L14675](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentService.ts#L14664-L14675); [agentService.ts#L14758-L14765](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentService.ts#L14758-L14765) | - |
| A client a daemon restart forgot is refused with `-32008` and initializes, so its subscriptions are answered with snapshots | [handshake.ts#L513-L515](../../../../packages/sdk/src/host/handshake.ts#L513-L515) | - |
| A client served a state the host let go of since is answered with snapshots when it reconnects | [protocolServerHandler.ts#L690-L701](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/protocolServerHandler.ts#L690-L701); [protocolServerHandler.ts#L1374-L1379](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1374-L1379) | 01 |
| A command's turn is kept as the chat's state holds it | [localChatCommand.ts#L229-L247](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/localCommands/localChatCommand.ts#L229-L247) | 02 |
| A kept command's turn keeps its terminal: this host rebuilds the terminal after a restart, exited, with its output | [localChatCommand.ts#L250-L275](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/localCommands/localChatCommand.ts#L250-L275) drops it because its PTY ends; [host-local-turns.test.ts](../../../../packages/sdk/test/host-local-turns.test.ts) opens it after a restart | 02 |
| A Claude call with no result reads back cancelled as skipped, and the turn holding it cancelled | [claudeReplayMapper.ts#L389-L417](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L389-L417); [claudeReplayMapper.ts#L492-L514](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L492-L514) | 03 |
| A pi or ACP call the record never ends reads back the same, and the turn holding it cancelled | [claudeReplayMapper.ts#L492-L514](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L492-L514); [reducer.ts#L172-L210](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L172-L210) | 04 |
| A pi turn reads back every answer's usage summed, as its live turn says it | [mapping.ts `addUsage`](../../../../packages/agent-pi/src/mapping.ts) | 04 |
| A pi turn's origin, its calls' `not-needed` and its message's text need nothing: the reference reads a Claude turn back the same | [claudeReplayMapper.ts#L446-L458](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L446-L458); [claudeReplayMapper.ts#L503-L510](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L503-L510) | - |
| A bot turn cut off reads back complete and needs nothing: its begun line holds no call, and the reference reads a turn with no open call back complete | [chat.ts#L789-L796](../../../../packages/bot/src/chat.ts#L789-L796); [claudeReplayMapper.ts#L497](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L497) | - |

## Proposed architecture

- **Data flow** - a backend's record is read through its agent and seeds the held state; a client is served that state whole.
- **State flow** - a held state records the clients it was served to; letting it go marks each of them owed a snapshot.
- **Layer responsibilities** - sdk host: the baseline a reconnect is answered from, and the turns it keeps. Backends: a read-back that ends turns as the reference does.
- **Source-of-truth files** - [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a client is owed the state it lost](task-01-a-client-is-owed-the-state-it-lost.md) | done | - |
| [02 - a command's turn is kept as its clients hold it](task-02-a-commands-turn-is-kept-as-held.md) | done | - |
| [03 - a Claude turn reads back as the reference reads it](task-03-a-claude-turn-reads-back-as-the-reference.md) | done | - |
| [04 - pi and ACP turns read back the same way](task-04-pi-and-acp-turns-read-back-the-same.md) | done | - |

## Risks and tradeoffs

- A turn the daemon died in reads back cancelled while a call in it had no result, where a client watching it saw it running.
- A client asking for a channel it was never served is replayed to, as the reference replays to it.

## Resume state

- **Done so far:** tasks 01 to 04.
- **Next action:** none; the plan is built.
- **Open questions:** none.
- **Watch out for:** a state is served through `answeredAs` whichever way a client asked for it.

## Final verification checklist

- [x] Each change has a case that fails before it, for the reason it names, and passes after it.
- [ ] `pnpm run test:unit --maxWorkers=2` passes, with each failure under load passing alone.
- [x] `pnpm run typecheck` and `pnpm run boundary` exit 0, and the prose lint is clean.
