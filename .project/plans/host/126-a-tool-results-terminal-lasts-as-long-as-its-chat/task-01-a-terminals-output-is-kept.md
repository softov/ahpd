---
title: A terminal's output is kept under an address that names its chat
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/terminals.ts#L95-L144](../../../../packages/sdk/src/host/terminals.ts#L95-L144) - `commanded`, the `!` command's terminal"
  - "[code://packages/sdk/src/host/terminals.ts#L184-L255](../../../../packages/sdk/src/host/terminals.ts#L184-L255) - `heldTerminals`, a backend's terminal"
  - "[code://packages/sdk/src/host/channels.ts#L148-L170](../../../../packages/sdk/src/host/channels.ts#L148-L170) - the encoding the address follows"
  - "[code://packages/sdk/src/sessions/sessions.ts#L583-L611](../../../../packages/sdk/src/sessions/sessions.ts#L583-L611) - the session's folder"
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/common/nonPtyShellTerminalUri.ts#L17-L55 - the reference's address and its reader
---

## Objective

A `!` command's terminal and a terminal a backend opens are named `ahp-terminal://shell/<base64url(chat)>/<encoded key>` from their start.
When the process exits, the host keeps its output and exit code in the session's folder, under the chat and the key.

## Files

- `UPDATE: packages/sdk/src/host/channels.ts:148-170` - `retainedTerminalUri` and `retainedTerminalOf`, beside `subagentChatUri`.
- `CREATE: packages/sdk/src/host/outputs.ts` - the files: where one is, keep, read, forget and move.
- `UPDATE: packages/sdk/src/host/terminals.ts:95-255` - the two terminals take the address, and keep their output at exit.
- `UPDATE: packages/sdk/src/host/context.ts:48` - `HostContext` takes the new area.
- `UPDATE: packages/sdk/src/host.ts:1105` - build the area.
- `CREATE: packages/sdk/test/host-retained-terminals.test.ts` - the cases below.

## Steps

1. Write `retainedTerminalUri(chat, key)` with the base64url chat and the encoded key, under the `shell` authority.
2. Write `retainedTerminalOf(uri)`, which answers the chat and the key, or nothing for any other URI.
3. Write the file path: the session's folder, then `terminals`, then the SHA-256 of the chat and of the key.
4. Write `keep`, which refuses an output over 10 MB and writes `{ version, output, exitCode }` with `writeJsonAtomic`.
5. Write `read`, which reads the file with `readJson` and checks each field it returns.
6. Name the `!` command's terminal with its claim's chat and tool call.
7. Name a backend's terminal with its chat and a new UUID.
8. Keep each one's output and exit code when it says `terminal/exited`, before the command's result goes back.

## Validation

- The address carries a chat and a key there and back, and a URI of another shape reads as nothing.
- A `!` command's terminal has the address, and its output and exit code are in the file once it exits.
- A backend's terminal has the address, and its output is in the file once it exits.
- An output over 10 MB is not kept.

## Resume

