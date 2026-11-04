---
title: A taken steer shows in its turn
domain: host
status: built
priority: medium
created: 2026-11-04
revalidated: 2026-11-04
refs:
  - git://4d703f16 - the commit of ahpd the facts were checked at
  - "[code://packages/bot/src/chat.ts#L1195-L1205](../../../../packages/bot/src/chat.ts#L1195-L1205) - the bot chat's `steer`, which draws nothing in the turn"
  - "[code://packages/bot/src/chat.ts#L845-L851](../../../../packages/bot/src/chat.ts#L845-L851) - `say`, which adds a part to the open turn: the pattern to copy"
  - "[code://packages/bot/src/chat.ts#L780-L795](../../../../packages/bot/src/chat.ts#L780-L795) - the line that ends a turn holds every part, so a read back has what the live turn had"
  - "[code://packages/agent-claude/src/session/query.ts#L281-L287](../../../../packages/agent-claude/src/session/query.ts#L281-L287) - Claude hands a steer to the CLI and removes it from the queue"
  - "[code://packages/agent-claude/src/transcript.ts#L405-L428](../../../../packages/agent-claude/src/transcript.ts#L405-L428) - the Claude reader, which reads no `attachment` frame"
  - problems/a-bot-steer-shows-differently-after-a-reload.md - covered by bots/20261103-0650, and deleted by this plan
  - https://github.com/microsoft/agent-host-protocol/blob/main/types/channels-chat/state.ts - `ResponsePartKind` has no kind for a user's words; `SystemNotificationResponsePart` is a harness notice for transcript continuity, with `_meta` and no id
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSteeringMessageHandoff.ts - VS Code shows a taken steer for at most 10 seconds
---

## Goal

A message a person steers into a running turn stays visible in that turn.
It shows live and after a reload, in a bot chat and in a Claude session.
On 2026-11-04 Softov steered "make it 10" into Ember, and neither chat showed it, so he sent it twice.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "queued_command" ~/.claude/projects/-home-softov--bots-ember/6d7a577f-*.jsonl` - the CLI writes an `attachment` frame of type `queued_command` with the prompt and `source_uuid`, where it took the steer in.
- `rg -n "attachment" packages/agent-claude/src/transcript.ts` - the reader reads no such frame.

### Runtime path

```
bot chat steer -> quote part in the open turn -> chat/responsePart -> the line that ends the turn keeps it
Claude steer handed to the CLI -> quote part in the turn it steered -> chat/responsePart; read back from the queued_command frame
```

### Gaps

- The bot chat's `steer` adds no part to the open turn.
- Claude adds no part when it hands a steer to the CLI, and its reader skips the `queued_command` frame.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The bot chat and Claude show a taken steer; cofold and pi wait until each is checked | Softov, 2026-11-04, "bot chat and claude, once others validate we also do that" | 01, 02 |
| The steer shows in the turn it went into, after the parts said before it | Softov, 2026-11-04, chose "A quote in the turn" | 01, 02 |
| The steer is a `systemNotification` part whose content is the message text | Softov, 2026-11-04, "ok, use systemNotification" | 03 |
| `_meta['ahpd.steer']` holds the steering message's id, and `steerPart` in `@ahpd/sdk` builds the part for every package | (defaulted: a `systemNotification` part has no id, and `ahpd.` is the prefix of ahpd's `_meta` keys) | 03 |
| A Claude steer shows live when the CLI says it started it, which is where the transcript records it | Softov, 2026-11-04, chose "When the CLI takes it in" | 02 |
| A Claude steer's id is the uuid ahpd handed the steer to the CLI with, live and read back | (defaulted: the CLI names the steer by that uuid in its frames and its transcript) | 02 |
| A turn the chat never began, which the host folds into the turn before it, keeps its message as the steer part before its answer | (defaulted: Claude writes a steer it ran after the last answer as such a turn) | 02 |
| The Claude reader puts a message the SDK marks `isQueuedCommand` inside an open turn back as the same steer part | (defaulted: the SDK gives the `queued_command` frame as that message) | 02 |

## Proposed architecture

- **Data flow** - `steerPart` builds the part from the message text and id, and the backend adds it to the turn's `responseParts`.
- **Event flow** - `chat/responsePart` with the part, after the steering message leaves the queue.
- **Layer responsibilities** - sdk: `steerPart` and the fold · bot: the part in the open turn · agent-claude: the part live and in the reader.
- **Source-of-truth files** - [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts), [`code://packages/agent-claude/src/transcript.ts`](../../../../packages/agent-claude/src/transcript.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the bot chat shows a steer](task-01-the-bot-chat-shows-a-steer.md) | done | - |
| [02 - Claude shows a steer it took in](task-02-claude-shows-a-steer-it-took-in.md) | done | - |
| [03 - a steer is a system notification](task-03-a-steer-is-a-system-notification.md) | done | 01, 02 |

## Risks and tradeoffs

- A client draws the steer as a harness notice, not as the person's message: the protocol has no part for a user's words.
- This departs from VS Code, which drops a taken steer after 10 seconds.

## Resume state

- **Done so far:** built on 2026-11-04 in #219 and #220, and Softov checked the steer in a bot chat. See [implemented.md](implemented.md).
- **Next action:** none. The cofold and pi steer parts wait, as [deferred.md](deferred.md) says.

## Final verification checklist

- [x] A bot chat steer shows in the open turn, live and after a reload.
- [x] A Claude steer shows in its turn when the CLI takes it in, and again when the transcript is read back.
- [x] Every steer part is a `systemNotification` with `_meta['ahpd.steer']`.
- [x] `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass, and the bot and agent-claude tests pass.
