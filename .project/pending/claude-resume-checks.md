---
title: Check that a failed Claude turn resumes
plans:
  - plans/claude/20261031-1200-a-failed-claude-turn-is-resumed/plan.md
---

# Check that a failed Claude turn resumes

The plan `claude/20261031-1200-a-failed-claude-turn-is-resumed` merged in #174, and its tests pass. These checks need a real model.

## Set up

```bash
source <(git -C /github/ahpd fetch -q origin && git -C /github/ahpd show origin/main:.project/pending/test-daemon.sh) agent-claude
```

Add the entry the script prints to `chat.remoteAgentHosts` in VS Code's `settings.json`, set `"chat.remoteAgentHostsEnabled": true`, and reload the window. Open a Claude session on `ahpd-check`.

## Steps

1. Send a prompt that works. Expect the turn to end complete.
2. Give Claude a bad key, and send a prompt that reads a file. Expect the turn to fail with a retry control. How to give it a bad key is an open question: see *A bad key*.
3. Put back a good key, and click retry. Expect the same prompt to run again on the conversation of step 1, with the file read again.
4. Expect the turn to end complete, with the old error part and the new answer in it.
5. In a new session, make the first turn fail on a bad key. Fix the key, and click retry. Expect the turn to start over.
6. Make a turn fail, and click retry. Send a second prompt while the retry runs. Expect it to run after the retry.

## A bad key

No tested way yet. On 2026-11-03 on a test daemon:

- A wrong `ANTHROPIC_API_KEY` in the agent record is not used while the Claude CLI is signed in. The turn answered.
- A record with an empty `CLAUDE_CONFIG_DIR` fails the turn with "Not logged in". The session loses its earlier conversation, and a real `ANTHROPIC_API_KEY` in the same record still fails.

Say which failure the check uses.

## Reply

- Write "pass", or what went wrong at which step.
- Stop the test daemon with `ahpd stop`.
