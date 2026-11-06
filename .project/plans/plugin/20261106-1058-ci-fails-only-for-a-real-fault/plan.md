---
title: CI fails only for a real fault
domain: plugin
status: planned
priority: high
created: 2026-11-06
revalidated: 2026-11-06
decisions:
  - decisions/on-windows-a-test-has-twenty-seconds.md
problems:
  - problems/three-cases-fail-at-random-on-windows.md
  - problems/two-attachment-cases-time-out-on-windows.md
  - problems/a-cofold-titling-case-times-out-on-windows.md
refs:
  - git://04a43a2f - the last commit that holds the brief `briefs/ci-fails-only-for-a-real-fault.md`, with the CI runs read
  - "[code://vitest.config.ts#L34](../../../../vitest.config.ts#L34) - `testTimeout`: 20 s on Windows, 5 s elsewhere"
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L36-L43](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L36-L43) - `when`, which throws after 5000 ms of wall-clock time"
  - "[code://packages/computer/test/computer-servercheck.test.ts#L115-L125](../../../../packages/computer/test/computer-servercheck.test.ts#L115-L125) - the case that runs the real server check script on the runner"
  - "[code://packages/computer/src/servercheck.ts#L72-L74](../../../../packages/computer/src/servercheck.ts#L72-L74) - the script's `docker version` and `docker info`"
  - "[code://packages/activepieces/src/files.ts#L223-L235](../../../../packages/activepieces/src/files.ts#L223-L235) - `attachmentOf`, whose streaming body opens its file after it is returned"
  - "[code://packages/activepieces/test/files.test.ts#L104-L117](../../../../packages/activepieces/test/files.test.ts#L104-L117) - the streaming case"
  - "[code://packages/sdk/test/host-attachments.test.ts#L355-L415](../../../../packages/sdk/test/host-attachments.test.ts#L355-L415) - the two attachment cases"
  - git://bbe4ea34 - "what comes after a waiting stop waits for it", in #208, after which the attachment cases fail
  - plans/plugin/30-two-more-tests-wait-for-their-session/plan.md - the sibling plan: a case waits on its writer, no retries
---

## Goal

ahpd's CI fails only for a fault in the code.
Today a run on `main` or on a PR fails at random on a few known cases.
Windows CI blocks a merge until a rerun passes.
This plan fixes the cases that failed in two or more runs, and finds the fault behind the attachment case.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.
The CI runs read, and the count for each case, are in the brief at `git://04a43a2f`.

### Searches performed

- `gh run list --workflow CI --created '>=2026-10-30'` and the failed jobs' logs - 21 failed runs; the `FAIL` lines give the cases.
- `rg "timed out waiting|Date.now\(\) \+ ms" packages/*/test` - 27 test files with a wait helper that has a deadline of its own.
- `rg "docker (version|info)" packages/computer/src` - the server check script asks the host's Docker daemon.

### Gaps

- The cofold `when` has a 5000 ms deadline, under the 20 s that the suite gives a case on Windows.
- The servercheck case asks the runner's Docker daemon, which it does not assert on.
- The streaming body opens its file after `attachmentOf` returns, and nothing listens for its `error`.
- The attachment case waits 15 s for a steering message that never arrives. The cause is not found.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan the brief | Softov, 2026-11-06: "ok, plan it." | all |
| CI does not turn on Vitest's `retry` | Softov, 2026-11-06, asked "Should CI turn on Vitest's retry until the flake fixes land?": "No retry (Recommended)" | all |
| The streaming body is fixed in the test and in the code | Softov, 2026-11-06, asked "Fix only the test, or the code too?": "Test and code (Recommended)" | 03 |
| Only the cases that failed in two or more runs are fixed; a case that failed once gets a problem record when it fails again | Softov, 2026-11-06, asked "Does this plan read the cases that failed once?": "Only repeat failures (Recommended)" | 05 |
| The cofold `when` keeps its loop and loses its deadline; the suite's `testTimeout` ends a case | (defaulted: [`decisions/on-windows-a-test-has-twenty-seconds.md`](../../../decisions/on-windows-a-test-has-twenty-seconds.md) sets the limit once, in `vitest.config.ts`) | 01 |
| The servercheck case puts a `docker` that exits at once first on the script's `PATH` | (defaulted: the case asserts nothing that `docker` answers) | 02 |
| The streaming body comes from a file handle opened before the body is made; a file that does not open is no file, `null`, as a missing file is today | (defaulted: one open, no race between `stat` and the stream) | 03 |
| The attachment fault is looked for on Linux first, then on a Windows runner through the branch's PR | (defaulted: a Linux loop costs nothing on CI) | 04 |
| The attachment fix is product code in the host, so its cause and fix go to Softov before it is built | (defaulted: a code change the brief did not describe) | 04 |

## Proposed architecture

- **Data flow** - no change, except the streaming body: `attachmentOf` opens the file, takes its size from the handle, and makes the body from the handle.
- **Event flow** - a test waits for the event it needs: a turn's end, a body's `close`, a steering message.
- **State flow** - no change.
- **Layer responsibilities** - tests: each case waits on its own event, under the suite's limit · `@ahpd/activepieces`: a missing file throws nothing in the daemon.
- **Source-of-truth files** - [`code://vitest.config.ts`](../../../../vitest.config.ts), the one limit for a case.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The cofold when has no deadline of its own](task-01-cofold-when-has-no-cap-of-its-own.md) | todo | - |
| [02 - The servercheck case answers docker at once](task-02-servercheck-answers-docker-at-once.md) | todo | - |
| [03 - A streamed file opens before its body](task-03-a-streamed-file-opens-before-its-body.md) | todo | - |
| [04 - The steering after attachments arrives](task-04-the-steering-after-attachments-arrives.md) | todo | - |
| [05 - The fixed cases leave the problem records](task-05-the-fixed-cases-leave-the-problems.md) | todo | 01, 02, 03, 04 |

## Risks and tradeoffs

- A case with no deadline of its own fails with Vitest's "Test timed out" - the test name still says which case.
- MayCXC's branch `host/124-an-agents-shell-is-a-terminal-the-person-sees` adds 28 lines to `agent-cofold-tools.test.ts` - task 01 changes only `when`, and the merge of his branch keeps it.
- The attachment fault may not show on Linux - task 04 then runs the case on a Windows runner before it says anything about a cause.
- Task 04 may find the fault in the case, not in the host - the case is then fixed as a test.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-cofold-when-has-no-cap-of-its-own.md](task-01-cofold-when-has-no-cap-of-its-own.md). Tasks 01 to 04 do not depend on each other.
- **Open questions:** none.
- **Watch out for:** never make a wait longer to pass a case, and never add a retry. One test suite at a time on Softov's machine. Task 04 stops at the cause and reports it.

## Final verification checklist

- [ ] Each changed test file passes 24 times in a row alone on Linux.
- [ ] `pnpm typecheck`, `pnpm boundary` and `pnpm test` pass.
- [ ] The PR's CI passes, Windows jobs included, with no rerun.
- [ ] The three problem records hold only the cases this plan did not fix, or are deleted.
