---
title: A test removes its folder while a child process still writes in it
status: open
date: 2026-10-18
severity: minor
refs:
  - "[code://packages/agent-acp/test/agent-acp-ports.test.ts#L87-L95](../../packages/agent-acp/test/agent-acp-ports.test.ts#L87-L95) - the teardown that failed in the policy/02 gates"
  - "[code://packages/server/test/server-cli-service.test.ts](../../packages/server/test/server-cli-service.test.ts) - the test that failed on CI"
  - https://github.com/softov/ahpd/actions/runs/39122204393 - the CI run that failed and then passed on a second run
  - "[code://packages/computer/test/computer-disposable.test.ts#L44-L50](../../packages/computer/test/computer-disposable.test.ts#L44-L50) - the disposable teardown, which removes its folders after `closeAll`"
  - "[code://packages/sdk/test/nested-process.test.ts#L54-L61](../../packages/sdk/test/nested-process.test.ts#L54-L61) - the teardown that kills each inner host and removes its folder at once"
---

## Symptom

`rmSync(path, { recursive: true, force: true })` fails with `ENOTEMPTY` in a test teardown.
On 2026-10-18 it failed `service install > names a relative configuration file in full` on CI for `61dbaeea`.
On the same day it failed `answers with the option the person picked, and says which` in the policy/02 gates.
Both tests pass when they run again, and the ACP test passes three times out of three alone.

In `nested-process.test.ts`, the teardown failed the same way in `processes (2/2)` on main, on `<home>/state`:

| Case | Run |
| --- | --- |
| a restart waits for the inner host it replaces, and resumes its conversation | 42925229918 |
| a daemon that stops leaves the session inside the machine for the next one | 43132937874 |

In `computer-disposable.test.ts`, the teardown of "lets the machine go when the new value is refused" failed the same way. It failed in `processes (1/2)`, in runs 42753469981 and 42804449764, and each passed when the job ran again.

## Cause

Unknown.
The likely cause is a child process that writes a file in the folder after the teardown starts to remove it.
The ACP teardown waits for one line in `requests.jsonl`, but not for the fake agent to exit.
The nested-process teardown sends `SIGKILL` to each inner host, and removes its folder without waiting for the exit.

Plan host/20261113-2319 makes the nested-process teardown wait for each inner host to exit, and the nested-process and disposable removals try again. The ACP and service-install teardowns are not changed.

## Impact

A full test run fails at random, so a red CI run or gate run needs a second run before it says anything.

## Workaround

None. Running the job again is not a fix.

## Fix

Wait for the child process to exit before the teardown removes its folder.
Or retry the removal with `maxRetries` and `retryDelay`, which `rmSync` takes for this error.
