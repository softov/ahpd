---
title: A taken steer shows in its turn
domain: host
status: planned
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
  - https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L1072-L1082 - a markdown part has an id and content, and no `_meta`
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
| The steer is a markdown quote of the message, `> ` before each line, in the turn it went into, after the parts said before it | Softov, 2026-11-04, chose "A quote in the turn" | 01, 02 |
| The quote part carries no `_meta`, and `steerQuote` in `@ahpd/sdk` builds it for both packages | (defaulted: a markdown part has no `_meta`, and the strict schema refuses an extra key) | 01, 02 |
| A Claude steer shows live when the CLI says it started it, which is where the transcript records it | Softov, 2026-11-04, chose "When the CLI takes it in" | 02 |
| The quote's id is `steer:<uuid>`, the uuid ahpd handed the steer to the CLI with, live and read back | (defaulted: the CLI names the steer by that uuid in its frames and its transcript) | 02 |
| The Claude reader puts a message the SDK marks `isQueuedCommand` inside an open turn back as the same quote | (defaulted: the SDK gives the `queued_command` frame as that message) | 02 |

## Proposed architecture

- **Data flow** - the quote is built once per package from the message text, and added to the turn's `responseParts`.
- **Event flow** - `chat/responsePart` with the quote, after the steering message leaves the queue.
- **Layer responsibilities** - bot: the quote in the open turn · agent-claude: the quote live and in the reader.
- **Source-of-truth files** - [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts), [`code://packages/agent-claude/src/transcript.ts`](../../../../packages/agent-claude/src/transcript.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the bot chat shows a steer](task-01-the-bot-chat-shows-a-steer.md) | implemented | - |
| [02 - Claude shows a steer it took in](task-02-claude-shows-a-steer-it-took-in.md) | implemented | - |

## Risks and tradeoffs

- A client draws the quote as markdown in the turn, the same as the answer around it - the quote marks it as quoted words.
- This departs from VS Code, which drops a taken steer after 10 seconds.

## Resume state

- **Done so far:** both tasks are implemented on 2026-11-04. The changed tests fail without the change.
- **Next action:** review, then the check by hand: steer Ember while it counts, and see the quote in both chats, live and after a reload.
- **Watch out for:** a bot back session's steer carries the context block before the person's words.
  The Claude quote shows the prompt as the CLI got it.
- **Not checked:** a steer the CLI ran after the turn's last answer is a prompt of its own in the transcript.
  The host's turn record folds it back into the turn it steered, and no test reads the quote after that fold.

## Final verification checklist

- [x] A bot chat steer shows as a quote in the open turn, live and after a reload.
- [x] A Claude steer shows as a quote in its turn when the CLI takes it in, and again when the transcript is read back.
- [ ] `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass, and the bot and agent-claude tests pass.
