---
title: Three cases that fail at random wait on what they mean - implemented
date: 2026-11-13
refs:
  - "[code://packages/sdk/test/agents-channel.test.ts](../../../../packages/sdk/test/agents-channel.test.ts)"
  - "[code://packages/sdk/test/nested-process.test.ts](../../../../packages/sdk/test/nested-process.test.ts)"
  - "[code://packages/computer/test/computer-spawn.test.ts](../../../../packages/computer/test/computer-spawn.test.ts)"
---

Three cases that failed main on 2026-11-13 now wait on events, and two problem files are closed.

## What was built

- The agents-channel case counts a list sent again the same as one change. The second change was the users watch's, for the token the case minted.
- The nested-process teardown waits for each inner host to exit, and its removal tries again. The disposable teardown's removals try again too.
- The computer-spawn case imports the backend at the top, waits for the stand-in CLI's file, and waits for the error.
- `problems/an-agents-channel-case-hears-two-changes.md` and `problems/the-case-of-a-claude-cli-that-is-gone-waits-on-fixed-times.md` are deleted. `problems/a-test-removes-its-folder-while-a-child-writes-in-it.md` says what is left.
- `problems/computer-cases-time-out-on-a-busy-machine.md` has one more case that times out on Softov's machine with no change.

## Verified

- `pnpm typecheck` is clean.
- The agents-channel case passed three times, and once with its wait at 1500 ms.
- The nested-process file passed, 14 cases.
- The computer-spawn file passed three times in a row, 7 cases each.
- The disposable file passed but for "takes the machine's own git volume with it", which times out the same way at `2bf97a6c1` with no change.

## Departures from the plan

- None.

## Left for later

- The ACP and service-install teardowns of the nested-process problem file.
