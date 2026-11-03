---
title: Check that a failed cofold turn resumes
plans:
  - plans/cofold/20261031-1200-a-failed-cofold-turn-is-resumed/plan.md
---

# Check that a failed cofold turn resumes

The plan `cofold/20261031-1200-a-failed-cofold-turn-is-resumed` merged in #177, and its tests pass. These checks need a real model endpoint.

## Set up

```bash
source <(git -C /github/ahpd fetch -q origin && git -C /github/ahpd show origin/main:.project/pending/test-daemon.sh) agent-cofold
```

Add the entry the script prints to `chat.remoteAgentHosts` in VS Code's `settings.json`, set `"chat.remoteAgentHostsEnabled": true`, and reload the window. Open a cofold session on `ahpd-check`.

## Steps

1. Send a prompt that works. Expect the turn to end complete.
2. Give the cofold model a bad key, and send a prompt that reads a file. Expect the turn to fail with a retry control. How to give it a bad key is an open question: see *A bad key*.
3. Put back a good key, and click retry. Expect the same prompt to run again on the conversation of step 1, with the file read again.
4. Expect the turn to end complete, with the old error part and the new answer in it.
5. In a new session, make the first turn fail on a bad key. Fix the key, and click retry. Expect the turn to start over in the same workspace.
6. Make a turn fail, and click retry. Send a second prompt while the retry runs. Expect it to run after the retry.
7. Point the session at a folder ahpd cannot use, so the turn fails before it runs. Expect no retry control.

## A bad key

Not checked yet: where this agent reads its key on a test daemon. Say how you want the key set, or ask me to find it.

## Reply

- Write "pass", or what went wrong at which step.
- Stop the test daemon with `ahpd stop`.
