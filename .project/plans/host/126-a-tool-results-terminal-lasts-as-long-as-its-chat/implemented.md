---
title: A terminal a tool result names lasts as long as its chat - implemented
date: 2026-10-27
refs:
  - git://2ac37255
  - "[code://packages/sdk/src/host/outputs.ts](../../../../packages/sdk/src/host/outputs.ts)"
  - "[code://packages/sdk/src/host/channels.ts](../../../../packages/sdk/src/host/channels.ts)"
  - "[code://packages/sdk/src/host/terminals.ts](../../../../packages/sdk/src/host/terminals.ts)"
  - "[code://packages/sdk/src/host/snapshots.ts](../../../../packages/sdk/src/host/snapshots.ts)"
  - "[code://packages/sdk/src/types/terminals.ts](../../../../packages/sdk/src/types/terminals.ts)"
  - "[code://packages/sdk/test/host-retained-terminals.test.ts](../../../../packages/sdk/test/host-retained-terminals.test.ts)"
---

A client opens a terminal that a tool call names for as long as the call's chat lasts.
This is true after a client disposed the terminal, after a backend released it, and after the daemon started again.
The host keeps what its own terminals print in the session's folder, and a backend keeps an output of its own the same way.
A subscribe that no live terminal answers gets the exited terminal, rebuilt from what was kept, as the reference host does.
What is kept goes with its turn, its chat and its session, and moves with its chat.

## What was built

- [`code://packages/sdk/src/host/channels.ts`](../../../../packages/sdk/src/host/channels.ts) - `retainedTerminalUri` and `retainedTerminalOf`: the `ahp-terminal://shell/<base64url(chat)>/<key>` address and its reader.
- [`code://packages/sdk/src/host/outputs.ts`](../../../../packages/sdk/src/host/outputs.ts) - the `Outputs` area: the files, the port for a chat, the rebuild, and the removals and the move.
- [`code://packages/sdk/src/host/terminals.ts`](../../../../packages/sdk/src/host/terminals.ts) - a `!` command's terminal and a backend's take the address and keep their output at exit, and `createTerminal` refuses the address.
- [`code://packages/sdk/src/host/snapshots.ts`](../../../../packages/sdk/src/host/snapshots.ts) - a subscribe asks for the rebuild when no live terminal has the name, and hands the outputs to a peer chat's transcript read.
- [`code://packages/sdk/src/host/history.ts`](../../../../packages/sdk/src/host/history.ts) and [`code://packages/sdk/src/host/sleep.ts`](../../../../packages/sdk/src/host/sleep.ts) - the other transcript reads hand the outputs of the chat they read.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) and [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - a truncation, a disposed chat and a moved chat take their outputs with them.
- [`code://packages/sdk/src/types/terminals.ts`](../../../../packages/sdk/src/types/terminals.ts) and [`code://packages/sdk/src/types/agent.ts`](../../../../packages/sdk/src/types/agent.ts) - `TerminalOutputs`, `Start.terminalOutputs`, and the third argument of `Agent.transcript`.
- [`code://docs/sdk/TERMINALS.md`](../../../../docs/sdk/TERMINALS.md), [`code://docs/sdk/AGENT.md`](../../../../docs/sdk/AGENT.md), [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md), the agent backends spec and the changelog say what a retained terminal is.

## Verified

- `packages/sdk/test/host-retained-terminals.test.ts`: 27 cases, every one passing.
- Each guard was broken in turn and its case failed without it, then passed with it again.
- The guards on what is kept: the byte count, the session that holds a moved chat, `isPty`, and a file of another version.
- The guards on the rebuild: a closed chat, an unfinished call, the parsed name, a cut preview, and a call with no result.
- The guards on the state: the exit code's order, and the kept output over the preview.
- The guards on the removals: another chat's output, the chat and the truncation, and the move and its refusal.
- The guards on the ports: the refused name, each of the five transcript reads, and the port where no folder is kept.
- `pnpm typecheck`, `pnpm boundary` and `pnpm build` ended with no errors.
- The sdk and agent suites first failed three cases in `subscribe.test.ts`, because a rebuild check put a tick before every snapshot.
- With that fixed, `subscribe.test.ts`, `changewords.test.ts` and the new suite pass, 55 cases.
- The whole suite ran under a load average of 10 to 26 from other agents' runs.
- It failed 364 of 7296 cases at the change and 369 of 7269 at the base `2c00f62c`.
- 286 failures are in both runs, 80 only at the change and 85 only at the base: timeouts, Docker and spawned daemons.
- Each sdk and agent file with a failure only at the change was run again with two workers.
- 983 of 985 passed, and the two left were timeouts that passed or moved on the next run.

## Departures from the plan

- `isPty` is kept with the output, because the daemon runs a `!` command under a pseudoterminal when it can.
- So the call is found by its address alone, and its content may say either.
- A call with no `result` is rebuilt from what was kept, because an ACP call carries none.
- A chat the record marks closed answers nothing, because a session's transcript still holds the calls of a first chat a client closed.
- `createTerminal` refuses a retained address, because the host defines those names.
- The rebuild reads a peer chat's transcript itself, and hands it the outputs too: a fifth read beside the four the plan named.
- `retainedState` answers nothing at once for any other name, so every other subscribe takes its snapshot in the tick it arrived in.
- A `!` turn is not in Claude's own transcript, so after a restart the case uses a transcript that names the output.

## Left for later

- Nothing.
