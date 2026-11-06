---
title: A steer starts its own turn
status: done
depends: []
layer: "bot"
refs:
  - "[code://packages/bot/src/chat.ts#L979-L986](../../../../packages/bot/src/chat.ts#L979-L986) - `steer`"
  - "[code://packages/bot/src/chat.ts#L347-L350](../../../../packages/bot/src/chat.ts#L347-L350) - `logAt`, the `steering` skip"
  - "[code://packages/bot/src/chat.ts#L664-L710](../../../../packages/bot/src/chat.ts#L664-L710) - `finish` and its call to `startNext`"
  - "[code://packages/bot/src/chat.ts#L772-L796](../../../../packages/bot/src/chat.ts#L772-L796) - `beginTurn`"
  - "[code://packages/bot/src/wake.ts#L420-L434](../../../../packages/bot/src/wake.ts#L420-L434) - `answering` and the subagent call"
  - "[code://packages/bot/test/bot-chat.test.ts#L364-L396](../../../../packages/bot/test/bot-chat.test.ts#L364-L396) - the steer test"
---

## Objective

A steer in a bot chat ends the open turn and starts a new turn with the steered text.
The back session's answer after the steer lands in the new turn.
A reload reads the same turns.

## Files

- `UPDATE: packages/bot/src/chat.ts:979-986` - `steer` ends the open turn and begins a new one.
- `UPDATE: packages/bot/src/chat.ts:664-710` - an end that does not start a queued message.
- `UPDATE: packages/bot/src/chat.ts:347-350` - read an old `steering` line as a turn of its own.
- `UPDATE: packages/bot/src/wake.ts:420-434` - `answering` follows the new turn.
- `UPDATE: packages/bot/test/bot-chat.test.ts:364-396` - the steer test expects two turns.
- `UPDATE: CHANGELOG.md` - a steered bot chat message shows as its own turn.

## Steps

1. Make `steer` refuse when no turn is open, as today.
2. End the open turn as `complete` with the parts it holds, without starting a queued message.
3. Begin a new turn with the steered text and its sender, through `beginTurn`.
4. Pass the new turn id to `onMessage`, so the wake sees the back session as working and steers it.
5. Move the `answering` entry in `wake.ts` to the new turn, so the answer lands there.
6. Keep one subagent call on the new turn for the same back-session chat.
7. Start a queued message only when the steered turn ends.
8. Read an old `steering` line in `logAt` as a finished turn with that message and no reply.
9. Change the steer test to expect the turns `hello` and `stop that` after a reload.
10. Add a changelog line.
11. Run the bot tests, and set this task and the plan row to `implemented`.

## Validation

- `bot-chat.test.ts`: a steer sends `chat/turnComplete` for the open turn, then `chat/turnStarted` with the steered text.
- `bot-chat.test.ts`: a reply after the steer lands in the new turn, and the first turn keeps its parts.
- `bot-chat.test.ts`: after a reload, the transcript is `hello`, then `stop that`.
- `bot-chat.test.ts`: a message queued before the steer starts only after the steered turn ends.
- `bot-chat.test.ts`: a log with an old `steering` line reads it as a turn.
- `bot-wake.test.ts`: a steer into a working back session sends the answer to the new turn.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** `steer` in `packages/bot/src/chat.ts` now ends the open turn and begins a turn of its own. The end is `finish(held, 'complete', [], false)`: a new `next` parameter leaves the queue waiting. The new turn takes `crypto.randomUUID()` as its id, and `beginTurn` hands that id to `onMessage`. `logAt` reads an old `steering: true` line as a finished turn of its own. Its id is derived (`<id>:steer`, with a counter for repeats), so it does not fold into the turn it steered. `wake.ts` needed no code change: `answering.set` already takes the turn id of the message, so a steer moves the entry. Only its comments changed. Tests: the bot chat steer case expects `chat/turnComplete` then `chat/turnStarted`. It also expects a new turn on the log, and `hello` then `stop that` after a reload. Two new cases cover a queued message behind a steered turn, and an old steering line as a turn. The subagent-call case expects one call on each turn, and the wake steer case expects the answer to follow the new turn. `CHANGELOG.md` has a `### Bots` line under 0.14.0.
- **Next action:** none; the plan's final verification checklist is next.
- **Files:** `packages/bot/src/chat.ts`, `packages/bot/src/wake.ts`, `packages/bot/test/bot-chat.test.ts`, `packages/bot/test/bot-wake.test.ts`, `CHANGELOG.md`, this task file, the plan and `plans/index.md`. The session cannot commit, so they are left in the worktree.
- **Open questions:** none.
- **Departures:** none.
- **Watch out for:** the steer test near line 590 keeps a single `subagent` call in one turn; it now expects one call on each turn.
