---
title: Check a message sent while a bot works
plans:
  - plans/host/20261102-1814-a-pending-message-runs-when-its-turn-comes/plan.md
  - plans/plugin/56-a-steered-bot-message-is-its-own-turn/plan.md
---

# Check a message sent while a bot works

A message sent in a bot chat while the bot works is a steer. Since ca82b8af (host/20261102-1814 task 03), it goes into the running turn, as VS Code's host does, and that turn goes on. Before, the steer ended the turn and began a new one. Nobody has checked this on a real bot yet.

With PR #200 merged, the main turn ends when the back session's turn ends. Run this check after the merge of plugin/20261103-1044, which keeps a steer from ending the main turn.

## Set up

Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

Open a bot chat in ahpw or VS Code.

## A message while the bot works

1. Send: `Count slowly from 1 to 30, one number per line, then post the last number.`
2. While the bot works, send: `Stop at 10 instead.`
3. Check that the main chat shows one turn, not two, with your second message in it.
4. Open the back session from the subagent call. Check that your second message reached it.
5. Check that the bot stops near 10, and that its post shows in the same main turn.
6. Check that the main turn ends when the back session's turn ends.

## The steer in the turn (host/20261104-0726)

1. Check that the bot chat shows your second message, `Stop at 10 instead.`, as a notice after the numbers posted before it.
2. Open the back session, and check that it shows the same words as a notice, with the context block.
3. Check that the notice sits between the two tool calls where Claude took it in.

## After a reload

1. Reload the window, and open the same bot chat and the back session.
2. Check that each shows one turn, with the notice where it was live.

## Reply

Write "pass" for each section, or what you saw.
