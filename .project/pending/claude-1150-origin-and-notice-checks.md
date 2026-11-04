---
title: Check the automation origin and the notice turn after a restart
plans:
  - plans/host/20261104-1150-an-automation-session-keeps-its-origin/plan.md
  - plans/claude/20261104-1150-a-background-task-end-is-a-notice/plan.md
---

# Check the automation origin and the notice turn after a restart

Both plans are built on branch `claude/20261104-1150-a-background-task-end-is-a-notice`, which holds the host plan's commits too. There is no PR yet.
Each plan has one check that no gate covers: a run on a live daemon, with a restart.

## Set up

1. Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd.worktrees/build-agents-1a9c74f4 && node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

2. Keep `enableCustomTerminalTool` off, so Claude runs its own Bash.
3. Use ahpw on 5180. It has #39, which draws a `systemNotification` message as one muted line.

## The automation origin (host/20261104-1150)

1. Run an automation that starts a new session. A session from before this build has no stored origin, so use a new run.
2. Check that the session's first message has the "From an automation" chip.
3. Restart the daemon with the command of *Set up*, and reload ahpw.
4. Check that the first message still has the chip, and that a click on it opens the automation.

## The notice turn (claude/20261104-1150)

1. Open a new Claude session, and send: `With your Bash tool, run "sleep 20" in the background, then stop.`
2. Wait for the turn to end, then about 20 seconds more.
3. Check that a new turn starts with one muted line, such as `Background command "..." completed (exit code 0)`, and not an empty bubble.
4. Restart the daemon with the command of *Set up*, and reload ahpw.
5. Check that the chat shows the same muted line as a turn of its own, after the turn that ran the command.

## After the checks

Stop the daemon, and start it again from `/github/ahpd` with the same command.

## Reply

Write "pass", or say which step stopped.
