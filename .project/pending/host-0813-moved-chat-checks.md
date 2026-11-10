---
title: Check that ahpw and ahpc draw a chat that set_workspace or move_session moved
plans:
  - plans/host/20261110-0813-the-session-tools-follow-vscode/plan.md
---

# Check that ahpw and ahpc draw a chat that set_workspace or move_session moved

Task 02 step 6 of the plan. The builder could not start a daemon or a client, so it is checked by hand once the plan is merged and the daemon restarted.

## set_workspace on a Claude session

Claude works in more than one folder, so `set_workspace` moves the calling chat alone.

1. Open a Claude session in ahpw with two chats, both in one folder.
2. In the second chat, send: `Use set_workspace to move this chat to /tmp/ahpd-move-check, then stop.` Make the folder first.
3. Check that the second chat now shows `/tmp/ahpd-move-check` as its folder, and that a `Workspace Set` turn continues in it.
4. Check that the first chat still shows the first folder.
5. Open the same session in ahpc with `session show`, and check the same two folders.

## move_session

Turn on `chatMoves.enabled` first.

1. Open two Claude sessions in ahpw, the first with a nested chat.
2. In the second session's chat, send: `Use list_sessions, then move_session the first session's nested chat into this session.`
3. Check that the nested chat leaves the first session in the session list and shows under the second one.
4. Check that ahpc's `session show` for both sessions says the same.

A chat cannot move itself while its turn runs. VS Code schedules that move for the end of the turn, and ahpd refuses it for now, so the steps above move another session's chat.
