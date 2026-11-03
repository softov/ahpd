---
title: A steer keeps the back turn
domain: plugin
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
requires:
  - plans/plugin/20261103-0905-a-back-session-posts-more-than-once/plan.md
refs:
  - git://97b0ca4f - the commit of ahpd this plan was checked at
  - "[code://packages/bot/src/wake.ts#L593-L680](../../../../packages/bot/src/wake.ts#L593-L680) - `woken`, which picks a turn or a steer from `looked.working`, and ends the main turn on a refused send"
  - "[code://packages/bot/src/plugin.ts#L588-L604](../../../../packages/bot/src/plugin.ts#L588-L604) - `look`, whose `working` is the session's `InProgress` bit only"
  - "[code://packages/agent-claude/src/session/turns.ts#L620-L633](../../../../packages/agent-claude/src/session/turns.ts#L620-L633) - Claude refuses a turn while one is still starting, which the session status does not show"
  - problems/a-bot-chat-is-not-a-subagent-of-its-back-session.md - the wider problem this fix is one case of
---

## Goal

A message that a person sends into a bot's main turn while the back turn runs reaches the back turn as a steer.
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

- `woken` reads only the session status to pick a steer.
- A refused send removes the binding of a back turn that still runs.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A message into a main turn that the wake already answers from this session is a steer | (defaulted: since plan 0905 the `answering` entry lives until the back turn ends, so a turn runs there) | 01 |
| A refused steer keeps the binding and the open main turn, and the operator gets a problem line | (defaulted: the back turn still runs and still answers) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a steer keeps the back turn](task-01-a-steer-keeps-the-back-turn.md) | implemented | - |

## Risks and tradeoffs

- A refused steer reaches the operator log only. The person sees the back turn go on without their message.

## Resume state

- **Done so far:** [task-01-a-steer-keeps-the-back-turn.md](task-01-a-steer-keeps-the-back-turn.md) is implemented, with two cases in `bot-wake.test.ts`.
- **Next action:** review, then the check by hand in [bot-steer-checks.md](../../../pending/bot-steer-checks.md).
- **Open questions:** none.
- **Watch out for:** never use ports 5180 or 37537.

## Final verification checklist

- [x] A steer into a back turn that the wake started is sent as `chat/pendingMessageSet` `steering`, with the session status idle.
- [x] A refused steer ends no main turn, and a later `post_message` lands.
- [x] `pnpm --filter @ahpd/bot test` passes, run alone.
- [x] `pnpm typecheck` and `pnpm boundary` pass.
- [ ] By hand: [bot-steer-checks.md](../../../pending/bot-steer-checks.md).
