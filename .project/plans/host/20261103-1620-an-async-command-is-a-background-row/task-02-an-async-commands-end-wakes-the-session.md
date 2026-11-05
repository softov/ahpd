---
title: An async command's end wakes the session
status: done
depends:
  - task-01-an-async-command-is-a-row.md
layer: "@ahpd/sdk host"
refs:
  - "[code://packages/sdk/src/host/wakes.ts#L84-L121](../../../../packages/sdk/src/host/wakes.ts#L84-L121) - `begin`, the woken turn to share"
  - "[code://packages/sdk/src/host/wakes.ts#L142-L152](../../../../packages/sdk/src/host/wakes.ts#L142-L152) - `setWake`, one wake for each chat"
  - "[code://packages/sdk/src/host/tooling.ts#L1891-L1908](../../../../packages/sdk/src/host/tooling.ts#L1891-L1908) - the sender kept with a wake"
---

## Objective

When an async command ends, the host starts a turn on the call's chat, as a wake starts one.
The turn says the command, its exit code and the end of its output, cut to 60 KB.
It acts as the person who sent the turn that started the command.
A wake that the model set stays as it is.

## Files

- `UPDATE: packages/sdk/src/host/wakes.ts:84-121` - the body of `begin` becomes a function that a command's end also calls, with a prompt and a sender.
- `UPDATE: packages/sdk/src/host/shells.ts` - at an async command's end, call that function.
- `UPDATE: packages/sdk/test/shell-async.test.ts` - the cases.
- `UPDATE: docs/sdk/TERMINALS.md` - what `mode=async` does.

## Steps

1. Move the body of `begin` into a function that takes the chat, the prompt and the sender.
2. Call it from `begin`, so a wake works as before.
3. Keep the sender of the turn that started the command.
4. At the end of an async command, build the prompt from the command, the exit code and the output's end.
5. Call the function with that prompt and sender.
6. Write the tests and the docs.

## Validation

- `shell-async.test.ts`: the end of an async command starts a turn whose message names the command and its exit code.
- `shell-async.test.ts`: a chat with a turn running gets the message queued.
- `shell-async.test.ts`: a wake set with `schedule_wakeup` still fires after a command's end.
- `shell-async.test.ts`: the woken turn carries the sender.
- `host-wakes` cases pass unchanged.

## Resume
