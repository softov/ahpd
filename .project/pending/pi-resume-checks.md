---
title: Check that a failed pi turn resumes
plans:
  - plans/pi/20261031-0736-a-failed-pi-turn-is-resumed/plan.md
---

# Check that a failed pi turn resumes

The plan `pi/20261031-0736-a-failed-pi-turn-is-resumed` is on main (#168). These checks need a real model.

## Set up

```bash
source <(git -C /github/ahpd fetch -q origin && git -C /github/ahpd show origin/main:.project/pending/test-daemon.sh) agent-pi
```

Add the entry the script prints to `chat.remoteAgentHosts` in VS Code's `settings.json`, set `"chat.remoteAgentHostsEnabled": true`, and reload the window. Open a pi session on `ahpd-check`.

## Steps

1. Give pi a bad key for its provider, and send a prompt that reads a file. Expect the turn to fail with a retry control. How to give it a bad key is an open question: see *A bad key*.
2. Put back a good key, and click retry. Expect the same turn to continue, with no second read of the file.
3. Expect the turn to end complete, with the old error part and the new answer in it.
4. Make a turn fail again, and run `ahpd restart`. Open the session. Expect the retry control on the last turn.
5. Click retry. Expect the turn to continue from pi's file.
6. Make a turn fail, click retry, and stop the turn. Expect it to end cancelled.

## A bad key

Not checked yet: where this agent reads its key on a test daemon. Say how you want the key set, or ask me to find it.

## Reply

- Write "pass", or what went wrong at which step.
- Stop the test daemon with `ahpd stop`.
