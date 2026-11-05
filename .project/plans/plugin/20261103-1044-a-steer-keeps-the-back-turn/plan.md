---
title: A steer keeps the back turn
domain: plugin
status: built
priority: high
created: 2026-11-03
revalidated: 2026-11-04
requires:
  - plans/plugin/20261103-0905-a-back-session-posts-more-than-once/plan.md
  - plans/bots/20261103-1008-a-message-goes-to-the-back-session-queued/plan.md
refs:
  - git://586d4e5a - the commit of ahpd this plan was checked at
  - "[code://packages/bot/src/wake.ts#L523-L548](../../../../packages/bot/src/wake.ts#L523-L548) - the message the back session is handed: queued, as an agent's, since plan bots/20261103-1008"
  - "[code://packages/bot/src/wake.ts#L702-L757](../../../../packages/bot/src/wake.ts#L702-L757) - `woken` sends it, and ends the main turn on a refused send"
  - "[code://packages/bot/src/chat.ts#L1195-L1205](../../../../packages/bot/src/chat.ts#L1195-L1205) - `steer`, the one path where a person's message goes into the open main turn"
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/workbench/contrib/chat/browser/widget/input/chatQueuePickerActionItem.ts#L64-L73 - VS Code lets the person pick \"Add to Queue\" or \"Steer with Message\"
  - problems/a-bot-chat-is-not-a-subagent-of-its-back-session.md - the wider problem this fix is one case of
---

## Goal

A message that a person steers into a bot's open main turn reaches the back turn as a steer.
A message that begins a main turn reaches the back session queued, as plan bots/20261103-1008 says.
A refused steer does not end the main turn, and the back turn's posts still land in it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Fault

On 2026-11-03 at 10:36:41 UTC "Hi here.." opened main turn `745fbf2b` and woke `claude:/032ec6cb`.
Claude started that turn at 10:36:47.
At 10:36:51 "make it 5 minutes" went into the same main turn.
`look` said the session was not working, so the wake sent `chat/turnStarted`, and Claude refused it with "A turn is running in this chat".
The wake removed the session from `answering` and ended the main turn with "Gumbo was not woken".
The back turn's two `post_message` calls at 10:37:04 and 10:37:09 found no main turn.

### Gaps

- Since plan bots/20261103-1008, `woken` sends every message queued, so a steer waits behind the back turn it was meant for.
- `ChatMessage` does not say whether the person steered the message.
- A refused send removes the binding of a back turn that still runs.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A message the person steered into the open main turn goes to the back session as `steering`, and one that began a main turn goes `queued` | Softov, 2026-11-04, chose "Keep your choice" | 01 |
| The steer keeps the agent origin and the `vscode.chat.delegation` `_meta` of plan bots/20261103-1008 | (defaulted: one message shape for both kinds) | 01 |
| A steer adds no id to `waiting`, because the back turn that already answers the main turn takes it in | (defaulted: a steer is no turn of its own) | 01 |
| A refused steer keeps the binding and the open main turn, and the operator gets a problem line | (defaulted: the back turn still runs and still answers) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a steer keeps the back turn](task-01-a-steer-keeps-the-back-turn.md) | done | - |

## Risks and tradeoffs

- A refused steer reaches the operator log only. The person sees the back turn go on without their message.

## Resume state

- **Done so far:** built, and Softov checked it by hand on 2026-11-04. See [implemented.md](implemented.md).
- **Next action:** none.

## Final verification checklist

- [x] A message steered into the main turn is sent as `chat/pendingMessageSet` `steering`, and one that began a main turn as `queued`.
- [x] A refused steer ends no main turn, and a later `post_message` lands.
- [x] `pnpm --filter @ahpd/bot test` passes, run alone.
- [x] `pnpm typecheck` and `pnpm boundary` pass.
- [x] By hand: [bot-steer-checks.md](../../../pending/bot-steer-checks.md).
