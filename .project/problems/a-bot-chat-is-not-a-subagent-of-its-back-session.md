---
title: A bot chat is not tied to its back session as a subagent
status: open
date: 2026-11-03
severity: major
refs:
  - "[code://packages/bot/src/wake.ts#L292-L304](../../packages/bot/src/wake.ts#L292-L304) - `answering` and `begun`, the maps that tie a back session to a main turn, in memory only"
  - "[code://packages/bot/src/plugin.ts#L658](../../packages/bot/src/plugin.ts#L658) - `opening`, a third map for a back turn that starts while its main turn opens"
  - "[code://packages/bot/src/chat.ts#L530-L560](../../packages/bot/src/chat.ts#L530-L560) - `showWorking`, which draws the `subagent` call by hand"
  - "[code://packages/sdk/src/host/spawn.ts#L33-L40](../../packages/sdk/src/host/spawn.ts#L33-L40) - `Spawn`, the host's own worker chats, which a backend session asks for"
  - plans/plugin/20261103-0905-a-back-session-posts-more-than-once/plan.md - the latest fix on the path
  - plans/plugin/20261103-0158-a-bot-chat-follows-its-back-session/plan.md - the fix before it
---

## Symptom

Each way a turn crosses between the main chat and the back session is a separate path in the bot plugin.
Each path has needed its own fix.
On 2026-11-03 a second `post_message` in one back turn found no main turn to post to.
Before it, a turn typed in the back session did not show in the main chat, and a withdrawn question stayed in the main chat.

## Cause

The main chat is a `bot-chat` session that runs no model.
The back session is a separate session, and the host does not know that the two are related.
The bot plugin keeps the relation itself, in the maps `answering`, `begun` and `opening`, which a restart empties.
It copies each event by hand in each direction:

| From | To | Path |
| --- | --- | --- |
| main message | back turn or steer | `woken` |
| back turn start | main turn | `began`, `opening` |
| back `post_message` | main answer | `posted` |
| back turn end | main turn end | `turn_end`, then `finished` |
| back question or approval | main copy | `asking`, `withdrawn` |
| main answer or confirmation | back session | `onAnswer`, `onConfirm` |
| main stop | back cancel | `stopped` |

The `subagent` call in the main turn is drawn by `showWorking`.
It is not a worker chat of the host, which `Spawn` creates for a backend session.

## Impact

A person who uses a bot sees the main chat and the back session go out of step where a path is missing or wrong.
Each new case needs a change in the plugin, the wake and the chat.
After a restart, a back turn has no main turn.

## Workaround

none.

## Fix

- Rewrite the bot so that the host ties the back session to the main chat as a subagent, with one owner of the lifecycle.
- Keep the present design, and add a test for each row of the table in *Cause*, in both directions.
