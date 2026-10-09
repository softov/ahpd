---
title: Check ahpd restart by hand
plans:
  - plans/daemon/13-ahpd-restart/plan.md
---

# Check `ahpd restart` by hand

Tasks 01 to 03 are merged. Task 04 (`plugin config` says a recorded flag overrides it) is not built yet; I queue it for a builder. These are the plan's checks by hand. Your daemon runs in the foreground, so use a second daemon on another port.

## Steps

1. Run `ahpd start --port 9399 --path /tmp/x`, then `ahpd restart`. A restart acts on the daemon `ahpd start` recorded, not on your foreground one. The new daemon serves `/tmp/x`, and a session you made before the restart resumes.
2. Start a turn on that daemon. While it runs, `ahpd restart` names the session and does nothing. `ahpd restart --force` restarts.
3. In ahpapp connected to that daemon, use Restart (`POST /api/restart`). The daemon restarts.
4. After task 04 is built: start with `--plugin-option @ahpd/agent-claude.workerStop=session`, then run `ahpd plugin config @ahpd/agent-claude workerStop turn`. It says the flag overrides the change.
5. Stop the second daemon.

If you prefer, I can run steps 1, 2 and 4 on a second daemon myself. Step 3 needs ahpapp.

## Reply

Write "pass" per step, or "run 1, 2 and 4 yourself".

