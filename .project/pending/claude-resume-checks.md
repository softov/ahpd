---
title: Check that a failed Claude turn resumes
plans:
  - plans/claude/20261031-1200-a-failed-claude-turn-is-resumed/plan.md
---

# Check that a failed Claude turn resumes

The plan `claude/20261031-1200-a-failed-claude-turn-is-resumed` merged in #174, and its tests pass. These checks need a real model and a test ahpd under XDG scratch directories.

## Set up

1. Start a test ahpd from main, with `XDG_CONFIG_HOME` and `XDG_DATA_HOME` set to scratch folders.
2. Open a Claude session in VS Code.

## Steps

1. Send a prompt that works. Expect the turn to end complete.
2. Give Claude a bad key, and send a prompt that reads a file. Expect the turn to fail with a retry control.
3. Put back a good key, and click retry. Expect the same prompt to run again on the conversation of step 1, with the file read again.
4. Expect the turn to end complete, with the old error part and the new answer in it.
5. In a new session, make the first turn fail on a bad key. Fix the key, and click retry. Expect the turn to start over.
6. Make a turn fail, and click retry. Send a second prompt while the retry runs. Expect it to run after the retry.

## Reply

- Write "ok", or what went wrong at which step.
