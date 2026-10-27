---
title: A subscribe rebuilds an exited terminal from what was kept
status: todo
depends: [task-01-a-terminals-output-is-kept.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/snapshots.ts#L93-L95](../../../../packages/sdk/src/host/snapshots.ts#L93-L95) - the terminal snapshot"
  - "[code://packages/sdk/src/host/history.ts#L298-L397](../../../../packages/sdk/src/host/history.ts#L298-L397) - `past`"
  - "[code://packages/sdk/src/host/snapshots.ts#L415-L438](../../../../packages/sdk/src/host/snapshots.ts#L415-L438) - a peer chat's turns for a session no backend session holds"
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L10647-L10718 - the rebuild
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L883-L913 - the call that names the address
---

## Objective

A subscribe to a retained address that no live terminal has answers an exited `TerminalState`.
The state comes from the call that names the address and from the kept output.
A retained address whose chat or call is gone answers as an unknown terminal does now.

## Files

- `UPDATE: packages/sdk/src/host/outputs.ts` - `retainedState`: the chat, its turns, the call, the file, the state.
- `UPDATE: packages/sdk/src/host/snapshots.ts:93-95` - ask `retainedState` when the map has no terminal at the address.
- `UPDATE: packages/sdk/test/host-retained-terminals.test.ts` - the cases below.

## Steps

1. Read the chat and the key out of the address, and answer nothing for any other URI.
2. Find the session that holds the chat now, through the chat record or the default chat's own name.
3. Take the chat's turns from its live session, or from `past` and a peer chat's transcript when none is live.
4. Find the newest call whose content has a `terminal` with this resource and `isPty: false`.
5. Read the file, and answer nothing when the call says `truncated` and there is no file.
6. Take the output from the file, else from the call's preview.
7. Take the exit code from the call, else from the file.
8. Build the state: the title, one `unclassified` part, the exited lifecycle, the claim and the fields every terminal state has.

## Validation

- A `!` command's terminal that a client disposed is rebuilt: its output, its exit code, `isPty: false` and the chat's claim.
- A host started again on the same store rebuilds it from the backend's transcript.
- A backend's terminal is rebuilt after its release, with the exit code the file kept.
- An address no call names, and one whose chat is gone, answer `No agent for session`.
- A subscribe to a live terminal answers as before.

## Resume

