---
title: A backend keeps an output, and reads which are kept
status: todo
depends: [task-01-a-terminals-output-is-kept.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L344-L354](../../../../packages/sdk/src/types/agent.ts#L344-L354) - `Start.outputTerminals`"
  - "[code://packages/sdk/src/types/agent.ts#L834-L851](../../../../packages/sdk/src/types/agent.ts#L834-L851) - `Agent.transcript`"
  - "[code://packages/sdk/src/host/spawn.ts#L1039-L1049](../../../../packages/sdk/src/host/spawn.ts#L1039-L1049) - where `Start` gets its ports"
  - "[code://packages/sdk/src/host/history.ts#L377](../../../../packages/sdk/src/host/history.ts#L377) - `past` reads a transcript"
  - "[code://packages/sdk/src/host/snapshots.ts#L425](../../../../packages/sdk/src/host/snapshots.ts#L425) - a peer chat's transcript"
  - "[code://packages/sdk/src/host/sleep.ts#L316](../../../../packages/sdk/src/host/sleep.ts#L316) - a wake's lead chat"
  - "[code://packages/sdk/src/host/sleep.ts#L356](../../../../packages/sdk/src/host/sleep.ts#L356) - a wake's other chats"
---

## Objective

A backend keeps an output for its chat through `Start.terminalOutputs`, and a call names the address it answers.
A backend reading a transcript is handed the same port for the chat it reads, so it can restore what is kept.

## Files

- `UPDATE: packages/sdk/src/types/terminals.ts` - `TerminalOutputs`: `uri`, `has` and `keep`.
- `UPDATE: packages/sdk/src/types/agent.ts:344-354` - `Start.terminalOutputs`.
- `UPDATE: packages/sdk/src/types/agent.ts:834-851` - the third argument of `Agent.transcript`.
- `UPDATE: packages/sdk/src/types/index.ts` - export `TerminalOutputs`.
- `UPDATE: packages/sdk/src/host/outputs.ts` - `outputsFor`, the port for one chat.
- `UPDATE: packages/sdk/src/host/spawn.ts:1039-1049` - hand the port on `Start`.
- `UPDATE: packages/sdk/src/host/history.ts:377` - hand the port for the session's own chat.
- `UPDATE: packages/sdk/src/host/snapshots.ts:425` - hand the port for the peer chat.
- `UPDATE: packages/sdk/src/host/sleep.ts:316-356` - hand the port for each chat a wake reads.
- `UPDATE: packages/sdk/test/host-retained-terminals.test.ts` - the cases below.

## Steps

1. Declare `TerminalOutputs` beside `OutputTerminals`.
2. Write `outputsFor(session, chat)`, which answers nothing where the store keeps no folder for the session.
3. Add `terminalOutputs` to `Start`, from `outputsFor` for the session and the chat it starts.
4. Add `outputs` as the third argument of `transcript`, and hand it at each of the four reads.

## Validation

- A backend's `keep` writes the file, its `has` says so, and a subscribe to its `uri` rebuilds the terminal.
- `Start.terminalOutputs` is absent for a host whose store keeps no folder.
- Each transcript read gets the port of the chat it reads.

## Resume

