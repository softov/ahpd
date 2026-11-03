---
title: Check that a VS Code window shows every turn of a long session
plans:
  - plans/host/114-a-subscribe-with-no-view-gets-every-turn/plan.md
---

# Check that a VS Code window shows every turn of a long session

host/114 is on main (#118). A subscribe that names no `view` gets every turn, so a VS Code window shows a long session from its first message. Use VS Code 1.143 or later, and a Claude session on your daemon with more than 50 turns.

## Set up

Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

## A session that is not running

1. In VS Code, open the long session from the session list. Do not send a turn.
2. Scroll to the top of the chat.
3. Check that the first message shown is the first message of the session.

## The same session after a turn

1. Send one short turn to the same session, such as "say ok".
2. Wait for the answer, then reload the window.
3. Open the session again, and scroll to the top.
4. Check that the first message shown is the first message of the session.

## Reply

Write "pass" for each section, or the first message the window showed. The reply goes into the Resume of task 01 in the plan.
