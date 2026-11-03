---
title: Idle steering runs ahead of the queue
status: doing
depends: []
layer: "sdk, agent-claude, agent-pi, agent-cofold, bot"
refs:
  - "[code://packages/sdk/src/types/session.ts#L657-L672](../../../../packages/sdk/src/types/session.ts#L657-L672) - `Session.queue`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1307-L1415](../../../../packages/sdk/src/host/lifecycle.ts#L1307-L1415) - `beginOrRun`"
  - git://46251ea3 - the change, built for an earlier round on a branch upstream had merged, with its host and ACP parts
---

## Objective

A steering message sent while no turn runs goes ahead of every queued message in Claude, pi, cofold, the bot and the nested proxy.
It is said as a steering message while it waits, and as one when it is taken back.
The host keeps refusing steering to a backend that takes none.

## Files

- `UPDATE: packages/sdk/src/types/session.ts` - `Session.queue` takes the pending message's kind.
- `UPDATE: packages/sdk/src/host/lifecycle.ts` - `beginOrRun` hands the kind to `queue`.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - the pending message case hands its kind on.
- `UPDATE: packages/sdk/src/sessions/nested.ts` - the proxy carries the kind to the host inside.
- `UPDATE: packages/agent-claude/src/session.ts` - the chat shows a waiting steering message as its `steeringMessage`.
- `UPDATE: packages/agent-claude/src/session/turns.ts` - `queue` puts a steering message at the head, and says its kind.
- `UPDATE: packages/agent-pi/src/session.ts` - the same for pi.
- `UPDATE: packages/agent-cofold/src/session.ts` - the same chat state for cofold.
- `UPDATE: packages/agent-cofold/src/turns.ts` - the same queue for cofold.
- `UPDATE: packages/bot/src/chat.ts` - the same for the bot.
- `UPDATE: packages/agent-cofold/test/agent-cofold-turn.test.ts` - an idle steering message runs ahead of what a stop left queued.
- `UPDATE: packages/sdk/test/host-steering.test.ts` - an idle steering message to a backend that takes none is refused.
- `UPDATE: docs/sdk/AHP.md` - the `chat/pendingMessageSet` row.
- `UPDATE: docs/sdk/CHATS.md` - where an idle steering message waits.

## Steps

1. Apply `46251ea3` to upstream main without committing it.
2. Restore the ACP and example files, and the two cases that held the dropped parts.
3. Restore the refusal of steering to a backend with no `steer`, and the docs that said otherwise.
4. Add the case that holds the refusal, and commit.
5. Compare the commit's changed lines with `46251ea3`'s.

## Validation

- The cofold case fails on `a8eff676` and passes after.
- The refusal case passes on both: it holds what main does.
- The changed lines are `46251ea3`'s, less the dropped parts.

## Resume
