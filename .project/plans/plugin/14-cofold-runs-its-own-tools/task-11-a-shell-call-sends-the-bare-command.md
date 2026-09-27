---
title: A shell call's tool input is its bare command
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/tools.ts#L191-L205](../../../../packages/agent-cofold/src/tools.ts#L191-L205) - `toolInputOf`, and `toolReadyAction` below it"
  - "[code://packages/agent-cofold/src/mapping.ts#L404-L426](../../../../packages/agent-cofold/src/mapping.ts#L404-L426) - the approval request, which writes the input on the part and the action"
  - "[code://packages/agent-cofold/src/mapping.ts#L491-L506](../../../../packages/agent-cofold/src/mapping.ts#L491-L506) - an approved call, the same"
  - "[code://packages/agent-cofold/src/session.ts#L1075](../../../../packages/agent-cofold/src/session.ts#L1075) - a `!` command, whose string input is the command itself"
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L363-L407](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L363-L407) - the terminal test and the approval request test"
---

## Objective

A `shell_exec` call's `toolInput` is the command itself, as Claude's Bash sends it, on the ready action, the approval request and the part a subscriber reads.

## Files

- `UPDATE: packages/agent-cofold/src/tools.ts:191-205` - one `toolInputOf(name, input)` beside `intentionOf`, used by `toolReadyAction`.
- `UPDATE: packages/agent-cofold/src/mapping.ts:404` and `:491` - `written` comes from `toolInputOf`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts:379-386` - the `toolInput` assertions.

## Steps

1. `toolInputOf(name, input)`: for `shell_exec` with a string `command`, the command; for a string input (the `!` path at `session.ts:1075`), the string unchanged; otherwise `JSON.stringify(input)`.
2. Use it at the three places that write `toolInput`, so the action and the part say the same thing.
3. Its doc comment says what the value is for each kind of call.

## Validation

- The terminal test asserts `chat/toolCallReady.toolInput === 'echo hi'` and the part's `toolInput === 'echo hi'`; both are `{"command":"echo hi"}` today.
- In `default`, the approval request for `shell_exec` carries `toolInput: 'echo hi'`.
- The `!` command test in `packages/agent-cofold/test/agent-cofold-turn.test.ts` gains an assertion that `toolInput` is the command without surrounding quotes; it is `"ls"` with the quotes today.
- `node_modules/.bin/vitest run packages/agent-cofold/test` green.

## Resume

Verified 2026-09-26: the second review reverted this task's fix and the test named in the Validation failed, then passed with the fix back.
The terminal case, the approval case and the `!` command case pass.
