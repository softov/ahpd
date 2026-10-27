---
title: A backend keeps an output, and reads which are kept
status: done
depends: [task-01-a-terminals-output-is-kept.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L344-L363](../../../../packages/sdk/src/types/agent.ts#L344-L363) - `Start.outputTerminals` and `Start.terminalOutputs`"
  - "[code://packages/sdk/src/types/agent.ts#L843-L865](../../../../packages/sdk/src/types/agent.ts#L843-L865) - `Agent.transcript`"
  - "[code://packages/sdk/src/host/spawn.ts#L1044-L1053](../../../../packages/sdk/src/host/spawn.ts#L1044-L1053) - where `Start` gets its ports"
  - "[code://packages/sdk/src/host/history.ts#L379](../../../../packages/sdk/src/host/history.ts#L379) - `past` reads a transcript"
  - "[code://packages/sdk/src/host/snapshots.ts#L436](../../../../packages/sdk/src/host/snapshots.ts#L436) - a peer chat's transcript"
  - "[code://packages/sdk/src/host/sleep.ts#L318](../../../../packages/sdk/src/host/sleep.ts#L318) - a wake's lead chat"
  - "[code://packages/sdk/src/host/sleep.ts#L358](../../../../packages/sdk/src/host/sleep.ts#L358) - a wake's other chats"
---

## Objective

A backend keeps an output for its chat through `Start.terminalOutputs`, and a call names the address it answers.
A backend reading a transcript is handed the same port for the chat it reads, so it can restore what is kept.

## Files

- `UPDATE: packages/sdk/src/types/terminals.ts` - `TerminalOutputs`: `uri`, `has` and `keep`, and what `release` leaves.
- `UPDATE: packages/sdk/src/types/agent.ts:344-363` - `Start.terminalOutputs`.
- `UPDATE: packages/sdk/src/types/agent.ts:843-865` - the third argument of `Agent.transcript`.
- `UPDATE: packages/sdk/src/types/index.ts` - export `TerminalOutputs`.
- `UPDATE: packages/sdk/src/host/outputs.ts` - `outputsFor`, the port for one chat, and the rebuild's own read of a peer chat.
- `UPDATE: packages/sdk/src/host/spawn.ts:1018-1053` - hand the port on `Start`.
- `UPDATE: packages/sdk/src/host/history.ts:377-379` - hand the port for the session's own chat.
- `UPDATE: packages/sdk/src/host/snapshots.ts:436` - hand the port for the peer chat.
- `UPDATE: packages/sdk/src/host/sleep.ts:316-358` - hand the port for each chat a wake reads.
- `UPDATE: packages/sdk/test/host-retained-terminals.test.ts` - the cases below.

## Steps

1. Declare `TerminalOutputs` beside `OutputTerminals`.
2. Write `outputsFor(session, chat)`, which answers nothing where the store keeps no folder for the session.
3. Add `terminalOutputs` to `Start`, from `outputsFor` for the session and the chat it starts.
4. Add `outputs` as the third argument of `transcript`.
5. Hand the port at each of the four reads and in the rebuild.

## Validation

- A backend's `keep` writes the file, its `has` says so, and a subscribe to its `uri` rebuilds the terminal.
- `Start.terminalOutputs` is absent for a host whose store keeps no folder.
- Each transcript read gets the port of the chat it reads.
- The case reads through a subscribe, a peer chat's snapshot and a wake.

## Resume

Done 2026-10-27.
The rebuild reads a peer chat's transcript itself, so it hands the port there too.
That is a fifth read beside the four the plan named.
