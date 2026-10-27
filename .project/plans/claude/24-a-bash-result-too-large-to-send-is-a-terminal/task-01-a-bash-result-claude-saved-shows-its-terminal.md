---
title: A Bash result Claude saved shows its terminal
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L769-L791](../../../../packages/agent-claude/src/session/query.ts#L769-L791) - the run loop, where the read goes before `results`"
  - "[code://packages/agent-claude/src/session/stream.ts#L528-L572](../../../../packages/agent-claude/src/session/stream.ts#L528-L572) - the completion's content, where the terminal goes after the text"
  - "[code://packages/agent-claude/src/session/workers.ts#L430-L445](../../../../packages/agent-claude/src/session/workers.ts#L430-L445) - `outputOf`, the output terminal pattern"
  - "[code://packages/agent-claude/src/session.ts#L109-L123](../../../../packages/agent-claude/src/session.ts#L109-L123) - where each area is built and joined to the context"
  - "[code://packages/agent-claude/src/session.ts#L287-L289](../../../../packages/agent-claude/src/session.ts#L287-L289) - `close`, where a background shell's terminals end"
  - "[code://packages/agent-claude/test/agent-claude-task-output.test.ts](../../../../packages/agent-claude/test/agent-claude-task-output.test.ts) - the fake SDK feed and the fake output terminal"
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L43-L94 - `capture`
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L145-L184 - the path, the text and the terminal content
---

## Objective

A `Bash` result whose output Claude saved to a file completes with an exited output terminal that holds that output, after the notice.
Every other result completes as it does today.

## Files

- `CREATE: packages/agent-claude/src/session/savedoutput.ts` - the path, the notice and the preview, the read, the terminal and the content held by call id.
- `UPDATE: packages/agent-claude/src/session/context.ts:149` - `SessionContext` takes the new area.
- `UPDATE: packages/agent-claude/src/session.ts:109-314` - build the area beside the others, and end its terminals in `close`.
- `UPDATE: packages/agent-claude/src/session/query.ts:769-791` - read the saved output before `results` maps a `user` message.
- `UPDATE: packages/agent-claude/src/session/stream.ts:528-572` - take the held terminal content and add it after the text.
- `CREATE: packages/agent-claude/test/agent-claude-saved-output.test.ts` - the cases below.

## Steps

1. Write `savedPathOf`: the `persistedOutputPath` of a `tool_use_result` that names no `backgroundTaskId`.
2. Write `previewOf` with the reference's notice pattern, and `noticeOf` for a string or the first text block.
3. Skip a subagent's message, a message without exactly one `tool_result`, and a call that is not `Bash`.
4. Skip a session with no `outputTerminals`, and a session in a machine.
5. Read a regular file of at most 10 MB, and give up on anything else or on an error.
6. Give up when the session closed or the running turn changed during the read.
7. Create the output terminal with the call's `displayName` as its title, on the session's chat.
8. Put the whole output in with `replace`, then call `finalize(0)` on success and `finalize()` on an error.
9. Hold the terminal content by call id, and dispose the terminal in `close`.
10. Await the read in the run loop before `results`, only for a message that names a saved output.
11. Add the held content after the text in `results`, and take it out of the map.
12. Write the cases in `agent-claude-saved-output.test.ts`.

## Validation

- A saved `Bash` result gets a terminal with the whole output, finalized with code 0, after the notice.
- A saved `Bash` result that failed gets a terminal finalized with no code, and its content has no exit code.
- An ordinary result, a subagent's result, a backgrounded command, another tool and a missing file get no terminal.
- A turn that someone cancels during the read gets no terminal, and `close` disposes a terminal it made.
- `pnpm boundary`, `pnpm typecheck`, `pnpm test` and `pnpm build` end with no errors.

## Resume

