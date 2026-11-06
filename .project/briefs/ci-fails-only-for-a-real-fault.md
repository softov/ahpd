---
title: CI fails only for a real fault
created: 2026-11-06
refs:
  - git://aee010bf - the commit of ahpd the facts were checked at
  - problems/three-cases-fail-at-random-on-windows.md - the cofold, computer and servercheck cases, recorded 2026-11-04
  - problems/two-attachment-cases-time-out-on-windows.md - the attachment cases, which start failing after #208
  - problems/a-cofold-titling-case-times-out-on-windows.md - the cofold titling case and the 5000 ms `when`
  - decisions/on-windows-a-test-has-twenty-seconds.md - the limit for a case is set once, in `vitest.config.ts`
  - "[code://vitest.config.ts#L34](../../vitest.config.ts#L34) - `testTimeout`: 20 s on Windows, 5 s elsewhere"
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L36-L43](../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L36-L43) - `when`, which throws after 5000 ms of wall-clock time"
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L476-L525](../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L476-L525) - the two edit cases, each a turn of three model steps"
  - "[code://packages/computer/test/computer-servercheck.test.ts#L115-L125](../../packages/computer/test/computer-servercheck.test.ts#L115-L125) - the case that runs the real server check script on the runner"
  - "[code://packages/activepieces/test/files.test.ts#L104-L117](../../packages/activepieces/test/files.test.ts#L104-L117) - the streaming case, which destroys a body that has not opened its file yet"
  - "[code://packages/activepieces/src/files.ts#L231-L232](../../packages/activepieces/src/files.ts#L231-L232) - the streaming body, a `createReadStream` with no `error` listener"
  - "[code://packages/sdk/test/host-attachments.test.ts#L391-L415](../../packages/sdk/test/host-attachments.test.ts#L391-L415) - the attachment case that waits 15 s for a steering message"
  - https://vitest.dev/config/retry - Vitest's `retry`, a count of runs again for a failed case, default `0`
  - https://vitest.dev/api/vi.html - Vitest's `vi.waitFor`, a wait for a callback with its own `timeout`, default 1000 ms
---

# CI fails only for a real fault

Softov chose on 2026-11-06 to start with the flaky cases: "Windows flakes (Recommended)".
ahpd's last three CI runs on `main` failed, and each failure was a case that passes on a rerun.
Windows CI blocks a merge, so each such failure costs a rerun of about 15 minutes.
The goal is a CI run that fails only for a fault in the code.

## What others do

- Vitest's `retry` runs a failed case again, up to a count. Its default is `0`, and ahpd does not set it.
- Vitest's `vi.waitFor` waits for a callback to pass, with a `timeout` of its own, 1000 ms by default.
- Neither tells a slow runner from a real fault. A retry passes a case that fails at random for a real reason, as the attachment case may.

## What ahpd has today

The failed CI runs since 2026-10-30 were read: 21 runs, on `main` and on branches.
One run, `41993290162`, failed 169 cases on a broken branch, and is left out.
A rerun that passes replaces the run's failure, so each count is a lowest count.

| Case | Job | Runs | What it waits on | Cause |
| --- | --- | --- | --- | --- |
| cofold tools, "reports an edit before the row that runs it" | Windows | 3 | `when(() => ended(v))`, capped at 5000 ms | Found: the cap is under the 20 s limit |
| cofold tools, "reports a file edit through onFileEdit" | Windows | 2 | the same | Found: the same |
| cofold tools, "titles a row by the subject cofold sent" | Windows | 1 | the same | Found: the same |
| servercheck, "runs its own script under sh" | Linux | 3 | `docker version` and `docker info` on the runner's daemon | Found: the runner's Docker daemon |
| activepieces files, "is given a body to read" | Linux | 2 | nothing: an uncaught `ENOENT` on `big.txt` fails the job | Found: a race, described after this table |
| host attachments, "applies a message with attachments before what the client sent behind it" | Windows | 3 | a steering message, 15 s | Not found |
| devcontainer, "omits the dev container row for a URI it cannot read a folder from" | Windows | 1 | a Docker state, `answered(dockerState, 3)` | Not checked |

- The cofold `when` waits for the event, and throws after 5000 ms of wall-clock time ([`code://packages/agent-cofold/test/agent-cofold-tools.test.ts`](../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L36-L43)). The suite gives a case 20 s on Windows.
- 27 test files have a wait helper with a deadline of its own. Not all of these deadlines were read.
- The servercheck case asserts only `arch`, `cpus`, `memory` and `user` ([`code://packages/computer/test/computer-servercheck.test.ts`](../../packages/computer/test/computer-servercheck.test.ts#L115-L125)). The script also asks the runner's Docker daemon.
- The streaming case destroys the body at once, and `afterEach` removes the folder. `createReadStream` opens its file after that, finds no file, and emits an `error` that nothing listens to.
- The streaming body in the code has no `error` listener either ([`code://packages/activepieces/src/files.ts`](../../packages/activepieces/src/files.ts#L231-L232)). Not checked: what the daemon does with an uncaught `error` from such a body.
- The attachment case fails with "still waiting after 15000 ms": the steering message never reaches the session. That is not a slow runner. The problem record ties the start of the failures to #208.
- The devcontainer failure is in the first attempt of #250's run `42172877253`. Its rerun passed, so the run shows no failure now.
- Cases that failed once each on Windows: nested-proxy, worktrees, cofold store, activepieces run and files, computer needs and devcontainer. These are not read.

## Who writes

| Writer | Files | What this change does to it |
| --- | --- | --- |
| MayCXC, `maycxc/host/124-an-agents-shell-is-a-terminal-the-person-sees` | `agent-cofold-tools.test.ts`, 28 lines added | A change to `when` in that file meets his branch. The branch is from 2026-10-27. |
| dsh build sessions, eight worktrees under `/github/ahpd.worktrees/` | each on its own plan branch | Each rebases on `main` after the fix, and gets the fix. |
| Every PR | CI | A PR stops failing for these cases once the fix is on `main`. |

## The change

- A wait in a test has no deadline under the suite's limit for a case. The cofold `when` loses its 5000 ms cap.
- The servercheck case runs the script with a `docker` on its `PATH` that answers at once, so it does not wait on the runner's daemon.
- The streaming case waits for the body to close before its folder goes.
- The streaming body in the code handles an error when it opens its file. A missing file then fails the read and throws nothing in the daemon.
- The attachment case is a fault to find, not a wait to make longer. Its cause is found before its fix.
- CI does not turn on Vitest's `retry`.
- A case that failed once is not read now. When it fails a second time, it gets a problem record of its own.
- Each problem record goes when its cases are fixed.

Softov's answers, 2026-11-06:

| Question | Answer |
| --- | --- |
| Should CI turn on Vitest's retry until the flake fixes land? | "No retry (Recommended)" |
| Fix only the test, or the code too, for the streaming body? | "Test and code (Recommended)" |
| Does this plan read the cases that failed once? | "Only repeat failures (Recommended)" |

## Open points

- How the attachment case is found: a loop of the case on Linux, or runs on a Windows runner.
