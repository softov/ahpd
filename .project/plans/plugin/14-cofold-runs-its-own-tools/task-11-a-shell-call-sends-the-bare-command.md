---
title: A shell call's tool input is its bare command
status: todo
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/tools.ts#L251-L262](../../../../packages/agent-cofold/src/tools.ts#L251-L262) - `toolReadyAction`, `JSON.stringify(input)` for every call"
  - "[code://packages/agent-cofold/src/mapping.ts#L404-L426](../../../../packages/agent-cofold/src/mapping.ts#L404-L426) - the approval request, which writes the input as JSON on the part and the action"
  - "[code://packages/agent-cofold/src/mapping.ts#L491-L506](../../../../packages/agent-cofold/src/mapping.ts#L491-L506) - an approved call, the same"
  - "[code://packages/agent-cofold/src/session.ts#L1080](../../../../packages/agent-cofold/src/session.ts#L1080) - a `!` command, whose string input `JSON.stringify` wraps in quotes"
  - "[code://test/agent-cofold-tools.test.ts#L266-L287](../../../../test/agent-cofold-tools.test.ts#L266-L287) - the terminal test, which checks `_meta` and `intention` but not `toolInput`"
---

## Objective

A `shell_exec` call's `toolInput` is the command itself, as Claude's Bash sends it, on the ready action, the approval request and the part a subscriber reads, per [decision: a shell call sends the bare command](../../../decisions/a-cofold-shell-call-sends-the-bare-command.md).

## Files

- `UPDATE: packages/agent-cofold/src/tools.ts:251-262` - one `toolInputOf(name, input)` beside `intentionOf`, used by `toolReadyAction`.
- `UPDATE: packages/agent-cofold/src/mapping.ts:404` and `:491` - `written` comes from `toolInputOf`.
- `UPDATE: test/agent-cofold-tools.test.ts:266-287` - the `toolInput` assertions.

## Steps

1. `toolInputOf(name, input)`: for `shell_exec` with a string `command`, the command; for a string input (the `!` path at `session.ts:1080`), the string unchanged; otherwise `JSON.stringify(input)`.
2. Use it at the three places that write `toolInput`, so the action and the part say the same thing.
3. Its doc comment says what the value is for each kind of call.

## Validation

- The terminal test asserts `chat/toolCallReady.toolInput === 'echo hi'` and the part's `toolInput === 'echo hi'`; both are `{"command":"echo hi"}` today.
- In `default`, the approval request for `shell_exec` carries `toolInput: 'echo hi'`.
- The `!` command test in `test/agent-cofold-turn.test.ts` gains an assertion that `toolInput` is the command without surrounding quotes; it is `"ls"` with the quotes today.
- `node_modules/.bin/vitest run test/agent-cofold` green.

## Resume
