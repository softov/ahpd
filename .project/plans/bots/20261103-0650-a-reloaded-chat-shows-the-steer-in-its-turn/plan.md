---
title: A reloaded chat shows the steer in its turn
domain: bots
status: built
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://cde4dd6c - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L171-L208 - each pending steering message is handed into the running turn once, and the turn goes on"
  - "[code://packages/bot/src/chat.ts#L1036-L1051](../../../../packages/bot/src/chat.ts#L1036-L1051) - `steer`, which hands the message into the open turn and logs it against that turn"
  - "[code://packages/bot/src/chat.ts#L339-L375](../../../../packages/bot/src/chat.ts#L339-L375) - `logAt`, which reads a `steering` line back as a turn of its own"
  - "[code://packages/agent-claude/src/transcript.ts#L418-L428](../../../../packages/agent-claude/src/transcript.ts#L418-L428) - the Claude backend reads a steering prompt back inside the turn it steered"
  - "[code://.project/plans/plugin/56-a-steered-bot-message-is-its-own-turn/plan.md](../../plugin/56-a-steered-bot-message-is-its-own-turn/plan.md) - the plan the reload's shape comes from"
---

## Goal

A bot chat read back after a restart shows the turn a steer went into, as the live chat does.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "steering" packages/bot/src/chat.ts` - `steer` logs a line against the open turn, and `logAt` makes a turn of its own out of it.
- `rg -n "isQueuedCommand" packages/agent-claude/src/transcript.ts` - the Claude backend skips a steering prompt that belongs to a turn.
- `rg -n "steering" docs/sdk/CHATS.md` - the bot's row says the log keeps the steer so a chat read back shows it.

### What the sources say

The live chat hands a steering message into the open turn, which goes on.
The message leaves the chat's state once it is handed on.

```ts
// packages/bot/src/chat.ts, `steer`
        start.emit('chat', { type: 'chat/pendingMessageSet', kind: 'steering', id: pendingId, message });
        append(dir, id, { id: held.id, steering: true, message, _meta: mark });
        ...
        start.emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'steering', id: pendingId });
```

That is VS Code's host, which hands each pending steering message to its provider once and leaves the turn running (queueDrainContribution L171-L208 at a4e689ae).
The Claude backend reads the same thing back the same way.

```ts
// packages/agent-claude/src/transcript.ts#L421-L428
      /*
       * A steering message the CLI took in at a tool call, which comes back
       * marked `isQueuedCommand` and is no turn of its own: its answer is the
       * turn's it steered, as it was live. One the CLI ran after the turn's last
       * answer is a prompt of its own here, and the host's record of the turns
       * a chat began puts it back in the turn it steered.
       */
      if (open !== undefined && frame.isQueuedCommand === true) continue;
```

The bot's reader makes a turn of its own out of the line, which is plugin/56's shape.
Its answer row reads "A steer ends the open turn and starts a new turn with the steered text".
The source it names is Softov's 2026-10-22 answer, "Its own turn".
That answer was for the live chat, which hands the steer into the open turn instead, by the VS Code source above.
Plugin/56's own row for the reload is `(defaulted: one reader for old and new logs)`, and the shape of a steered message in a chat is what VS Code's host decides.

### Runtime path

```
client chat/pendingMessageSet steering -> the bot's steer -> the open turn, which goes on
  the log keeps a line against that turn -> a reload shows that turn
```

### Gaps

- A reloaded chat shows a steer as a finished turn of its own with no reply.
- The live chat shows the turn it went into.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A chat read back shows the turn a steer went into, and no turn of its own | [queueDrainContribution.ts#L171-L208](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L171-L208); [code://packages/agent-claude/src/transcript.ts#L421-L428](../../../../packages/agent-claude/src/transcript.ts#L421-L428) | 01 |
| The log keeps the line, which is the record that the message was said | [code://packages/bot/src/chat.ts#L1046](../../../../packages/bot/src/chat.ts#L1046) | 01 |
| One reader for old and new logs, so a line written before the live chat changed reads the same way | [code://.project/plans/plugin/56-a-steered-bot-message-is-its-own-turn/plan.md](../../plugin/56-a-steered-bot-message-is-its-own-turn/plan.md) | 01 |

## Proposed architecture

- **State flow** - `logAt` takes a `steering` line as the record of a message in the turn it names, and reads no turn from it.
- **Source-of-truth files** - [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The reader reads the turn it steered](task-01-the-reader-reads-the-turn-it-steered.md) | done | - |

## Risks and tradeoffs

- A chat read back shows no steer, as the live chat shows none once it is handed on.

## Resume state

- **Done so far:** task 01, 2026-11-03.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** the line's mark is what names the chat's bot, so it is still read.

## Final verification checklist

- [x] Each changed case fails on `cde4dd6c` for the reason it names, and passes after the change.
- [x] The touched test files pass.
- [x] `pnpm run typecheck` reports no errors, and the prose lint is clean.
