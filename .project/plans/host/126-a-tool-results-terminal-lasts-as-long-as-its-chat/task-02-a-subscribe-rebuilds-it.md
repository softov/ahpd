---
title: A subscribe rebuilds an exited terminal from what was kept
status: done
depends: [task-01-a-terminals-output-is-kept.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/snapshots.ts#L93-L106](../../../../packages/sdk/src/host/snapshots.ts#L93-L106) - the terminal snapshot"
  - "[code://packages/sdk/src/host/history.ts#L298-L399](../../../../packages/sdk/src/host/history.ts#L298-L399) - `past`"
  - "[code://packages/sdk/src/host/snapshots.ts#L432-L450](../../../../packages/sdk/src/host/snapshots.ts#L432-L450) - a peer chat's turns for a session no backend session holds"
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L10647-L10718 - the rebuild
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L883-L913 - the call that names the address
---

## Objective

A subscribe to a retained address that no live terminal has answers an exited `TerminalState`.
The state comes from the call that names the address and from the kept output.
A retained address whose chat or call is gone answers as an unknown terminal does now.

## Files

- `UPDATE: packages/sdk/src/host/outputs.ts` - `retainedState`: the chat, its turns, the call, the file, the state.
- `UPDATE: packages/sdk/src/host/snapshots.ts:93-106` - ask `retainedState` when the map has no terminal at the address.
- `UPDATE: packages/sdk/test/host-retained-terminals.test.ts` - the cases below.

## Steps

1. Read the chat and the key out of the address, and answer nothing at once for any other URI.
2. Find the session that holds the chat now, through the chat record or the default chat's own name.
3. Answer nothing for a chat that the record marks closed.
4. Take the chat's turns from its live session, or from `past` and a peer chat's transcript when none is live.
5. Find the newest call a client saw run or finish whose content names the same chat and key.
6. Read the file, and answer nothing when the call says `truncated`, or has no `result`, and there is no file.
7. Take the output from the file, else from the call's preview.
8. Take the exit code from the call, else from the file, and `isPty` from the file, else from the call.
9. Build the state: the title, one `unclassified` part, the exited lifecycle, the claim and the fields every terminal state has.

## Validation

- A `!` command's terminal that a client disposed is rebuilt: its output, its exit code, `isPty` and the chat's claim.
- A `!` command under a pseudoterminal is rebuilt with `isPty: true`.
- A host started again on the same store rebuilds a terminal that a transcript names.
- The case runs for a session's first chat and for a peer chat.
- A backend's terminal is rebuilt after its release, with the exit code the file kept.
- An address no call names, one whose chat is gone, and one whose chat a client closed answer `No agent for session`.
- A call that a client never saw finish, and one cut short with nothing kept, answer the same.
- A subscribe to a live terminal answers as before, and a subscribe to any other channel takes no extra tick.

## Resume

Done 2026-10-27.
`retainedState` answers nothing at once for any other name: an extra tick before every snapshot failed three cases in `subscribe.test.ts`.
A `!` turn is not in Claude's own transcript, so after a restart only a call that a transcript names is rebuilt.
