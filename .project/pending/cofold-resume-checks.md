---
title: Check that a failed cofold turn resumes
plans:
  - plans/cofold/20261031-1200-a-failed-cofold-turn-is-resumed/plan.md
---

# Check that a failed cofold turn resumes

The plan `cofold/20261031-1200-a-failed-cofold-turn-is-resumed` merged in #177, and its tests pass. These checks need a real model endpoint.

## Set up

```bash
export PAPO_CONFIG=/home/softov/.config/cofold/config.json
source <(git -C /github/ahpd fetch -q origin && git -C /github/ahpd show origin/main:.project/pending/test-daemon.sh) agent-cofold
```

The script moves `XDG_CONFIG_HOME` to the test folder, where there is no papo file. `PAPO_CONFIG` points cofold at your own file, which holds the `open_router` provider.

Add the entry the script prints to `chat.remoteAgentHosts` in VS Code's `settings.json`, set `"chat.remoteAgentHostsEnabled": true`, and reload the window. Open a cofold session on `ahpd-check`.

## Steps

1. Send a prompt that works. Expect the turn to end complete.
2. Give the cofold model a bad key, and send a prompt that reads a file. Expect the turn to fail with a retry control. *A bad key* says how to give it one.
3. Put back a good key, and click retry. Expect the same prompt to run again on the conversation of step 1, with the file read again.
4. Expect the turn to end complete, with the old error part and the new answer in it.
5. In a new session, make the first turn fail on a bad key. Fix the key, and click retry. Expect the turn to start over in the same workspace.
6. Make a turn fail, and click retry. Send a second prompt while the retry runs. Expect it to run after the retry.
7. Point the session at a folder ahpd cannot use, so the turn fails before it runs. Expect no retry control.

## Results so far

- 2026-11-09: Softov set `baseUrl` and `apiKey` on the cofold agent record, as the record allows since host/122. The agent then listed no model. A save kept the agent, and the host never asked it again for its models. #269 fixed it; restart the daemon on main first.
- 2026-11-10: with the `baseUrl` `https://openrouter.ai/api/v1`, a turn answered. After a restart, a failed turn showed no error text, which #270 fixes. The title changed, as [the problem](../problems/a-cofold-title-changes-after-a-restart.md) says.

## A bad key

cofold reads its providers and keys from the file `PAPO_CONFIG` names, over papo's own file (`packages/agent-cofold/README.md`, *Options*). To give it a bad key:

1. Copy `/home/softov/.config/cofold/config.json` to `/tmp/cofold-bad.json`, and change the provider's key in the copy.
2. Stop the test daemon with `ahpd stop`.
3. Run the *Set up* again with `PAPO_CONFIG=/tmp/cofold-bad.json`.

To fix the key, run the *Set up* again with your own file.

## Reply

- Write "pass", or what went wrong at which step.
- Stop the test daemon with `ahpd stop`.
