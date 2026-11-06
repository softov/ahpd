---
title: The back session checks pass
status: implemented
depends: []
layer: bot, sdk
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1491-L1506](../../../../packages/sdk/src/host/chatactions.ts#L1491-L1506) - a steer with no turn running runs as a turn, since git://a3662128"
  - "[code://packages/bot/src/plugin.ts#L512-L528](../../../../packages/bot/src/plugin.ts#L512-L528) - `look`, which reads `working` from the session's `status`"
  - "[code://packages/bot/src/wake.ts#L605-L639](../../../../packages/bot/src/wake.ts#L605-L639) - the wake's turn or steer, and its notice on a refusal"
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

The test daemon ran `packages/server/src/main.ts` from this worktree on `127.0.0.1:43197` (pid 2985583).
Its `XDG_CONFIG_HOME` was `tmp/check01/config`, its file was `tmp/check01/config.json`, and it ran with `--sessions memory --automations memory --no-update-check`.
The config loaded the `agent-claude` and `bot` plugins and set `terminalAutoApproveDefaults` to `none`.
The bot was `atlas` on the `claude` harness, with the back session `ahp-session:/2469bda5-5f1c-4bda-9557-0c23351700d1` and the main session `ahp-session:/f96b2c3e-8397-4177-8578-e3d3fad31f43`.
Every turn ran, so the Claude harness needed no login beyond the `ANTHROPIC_*` settings of the environment.
The test daemon is stopped, and its port 43197 is closed.

- Check 1, steps 6 and 7: the back session asked to run `mkdir -p made-by-check01` in tool call `call_00_P9hoDEdWKJD1vKMddbSr6846`.
  The approval came from the back session, with `chat/toolCallConfirmed`.
  The back turn was `53a3bd80-87cc-454b-8065-8245936c6cc8`, and it ended with the call confirmed by `user-action`.
  After the turn ended, the back session's `status` was 1, without the `InProgress` bit, and `inputNeeded` was empty.
  That status is the catalogue row from `listSessions`, which is the status `drivingOf` makes from the chats; the session's one chat also said 1.
- Check 2, steps 8 and 9: the second main message, `Reply with the single word done.`, started back turn `d7ae767f-144e-4ea4-a438-cd5c17e74196`.
  No notice appeared in the main chat, and no steer was refused.
- Check 3, step 10: the back session held no `ahpd.steer` part and no `steeringMessage` before the send.
  It held none after the send, after back turn `d7ae767f-144e-4ea4-a438-cd5c17e74196` ended, or after a new connection reloaded the state.

One observation did not change a check: a direct `subscribe` to the back session answered `status: 8` after the turn ended.
Its chat said 1 at the same moment.
The protocol's session reducer leaves the `InProgress` bit when it removes the last `inputNeeded` entry.
This host moves the session status from its chats in the catalogue only.
That value was still 8 after the second turn and after the reload.

From `ss -ltnp` before the test daemon started: 5180 was held by pid 2770411 (fd 24).
37537 was held by pid 2949881 (fd 59).
After it stopped: 5180 was held by pid 2770411 (fd 24), and 37537 was held by pid 2949881 (fd 59).
Softov's own daemon was never read, stopped or started.
