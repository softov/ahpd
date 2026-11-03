---
title: The back session checks pass
status: todo
depends: []
layer: bot, sdk
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1484-L1499](../../../../packages/sdk/src/host/chatactions.ts#L1484-L1499) - a steer with no turn running runs as a turn, since git://a3662128"
  - "[code://packages/bot/src/plugin.ts#L512-L522](../../../../packages/bot/src/plugin.ts#L512-L522) - `look`, which reads `working` from the session's `status`"
  - "[code://packages/bot/src/wake.ts#L557-L590](../../../../packages/bot/src/wake.ts#L557-L590) - the wake's turn or steer, and its notice on a refusal"
  - "[code://packages/sdk/src/host/catalogue.ts](../../../../packages/sdk/src/host/catalogue.ts) - `drivingOf`, the session status made from its chats"
---

## Objective

A test daemon repeats what Softov saw with `gumbo` on 2026-11-02, and the three faults are gone on `main` since #193.
The wake keeps no fix of its own.

## Files

- `UPDATE: .project/plans/plugin/20261103-0158-a-bot-chat-follows-its-back-session/task-01-the-back-session-checks-pass.md` - the result of each check, in *Resume*.

## Steps

1. Start a test ahpd with `XDG_CONFIG_HOME` in the scratch folder, `--config-file`, `--sessions memory` and a free port.
2. Do not use ports 5180 or 37537, and do not touch Softov's running daemon.
3. Make a bot on a Claude harness.
4. Send a message on its main chat that makes the back session ask to run a command.
5. Approve the command on the back session, and let the back turn end.
6. Read the back session's `status`.
7. Record whether it holds the `InProgress` bit.
8. Send a second message on the main chat after the back turn ended.
9. Record whether the back session starts a turn for it, or the main chat shows a notice.
10. Record whether the back session shows a "Steering" message after the send, before and after a reload.
11. Stop the test daemon.
12. Stop and ask Softov when a check fails. Do not add a wake fix.

## Validation

- Each of the three checks has its result in *Resume*, with the turn ids.
- `ss -ltnp` shows ports 5180 and 37537 held by the same processes before and after.

## Resume
