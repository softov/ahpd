---
title: A Bash result too large to send is a terminal - implemented
date: 2026-10-27
refs:
  - git://e4843026
  - "[code://packages/agent-claude/src/session/savedoutput.ts](../../../../packages/agent-claude/src/session/savedoutput.ts)"
  - "[code://packages/agent-claude/src/claude.ts](../../../../packages/agent-claude/src/claude.ts)"
  - "[code://packages/agent-claude/test/agent-claude-saved-output.test.ts](../../../../packages/agent-claude/test/agent-claude-saved-output.test.ts)"
  - "[code://packages/sdk/test/claude-saved-output.test.ts](../../../../packages/sdk/test/claude-saved-output.test.ts)"
---

A Claude `Bash` call whose output was too large to send shows that output in a terminal in its content, as VS Code does.
The call keeps Claude's notice as its text, and the host keeps the output Claude saved for the call's chat.
The call names a terminal the host rebuilds from it, exited, for as long as the chat lasts.
A call read back from Claude's transcript names the terminal again, after a sleep and after a restart.

## What was built

- [`code://packages/agent-claude/src/session/savedoutput.ts`](../../../../packages/agent-claude/src/session/savedoutput.ts) - the reference's `capture` and `restore`: the file a result names, the read, the keep through `Start.terminalOutputs`, and the content.
- [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts) - the run loop reads a saved output before `results` maps its message, and only such a message waits.
- [`code://packages/agent-claude/src/session/stream.ts`](../../../../packages/agent-claude/src/session/stream.ts) - `results` adds the held terminal content after the text.
- [`code://packages/agent-claude/src/claude.ts`](../../../../packages/agent-claude/src/claude.ts) - `Start.terminalOutputs` reaches the session, and `transcript` restores the calls it reads with the outputs the host hands it.
- [`code://packages/agent-claude/src/session/context.ts`](../../../../packages/agent-claude/src/session/context.ts) and [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - the option and the area.
- [`code://packages/agent-claude/README.md`](../../../../packages/agent-claude/README.md), [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) and the changelog say what such a call shows.

## Verified

- `packages/agent-claude/test/agent-claude-saved-output.test.ts`: 23 cases, every one passing.
- They cover the live result and its failed form, the preview, every refusal, and the restore of a call read back.
- `packages/sdk/test/claude-saved-output.test.ts`: three cases through the host.
- They cover the subscribe, the restart with its call read back and rebuilt, and a store that kept nothing.
- `packages/sdk/test/conformance.test.ts`: the case reduces the call with the protocol's reducer and subscribes to the rebuilt terminal.
- Each guard was broken in turn and its case failed without it, then passed with it again.
- The guards on the read: the size limit, a keep the host refused, the first text, the turn and the close.
- The turn's guard reads the call's part in the running turn, so a stopped call's result that arrives while a later turn runs keeps nothing.
  Its case kept the output under a guard that asked only whether a turn ran.
- The guards on the restore: its three conditions, the call in `transcript`, and the port on the session.
- The refusals carried from the first design keep their code and cases.
- They are the subagent, the background task, two results, another tool and a session in a machine.
- `pnpm typecheck`, `pnpm boundary` and `pnpm build` ended with no errors.
- The agent-claude and sdk suites ran under a load average of 8 to 11 from other agents' runs.
- They failed 17 of 3982 cases, all timeouts or a nested host, and 9 of them also fail at the base `2c00f62c`.
- Each file with a failure only here passed when it ran alone: `changewords`, `nested-process` and `nested-proxy`.
- The two `nested-start` cases left fail at the base too.

## Departures from the plan

- The plan first kept the output in an output terminal that the session's close took down.
- The reference's design replaced it: host 126 keeps the output for the chat, and this plan uses its port.
- So a call read back finds its output, which the first design could not give task 02.
- The reference reads the preview from a result's first text only, and so does this; a notice split over two blocks gives none.

## Left for later

- Nothing.
