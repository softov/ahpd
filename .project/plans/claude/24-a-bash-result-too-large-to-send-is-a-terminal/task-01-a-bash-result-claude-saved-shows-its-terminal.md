---
title: A Bash result Claude saved shows its terminal
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L769-L799](../../../../packages/agent-claude/src/session/query.ts#L769-L799) - the run loop, where the read goes before `results`"
  - "[code://packages/agent-claude/src/session/stream.ts#L563-L582](../../../../packages/agent-claude/src/session/stream.ts#L563-L582) - the completion's content, where the terminal goes after the text"
  - "[code://packages/agent-claude/src/session.ts#L109-L123](../../../../packages/agent-claude/src/session.ts#L109-L123) - where each area is built and joined to the context"
  - "[code://packages/agent-claude/src/claude.ts#L690-L695](../../../../packages/agent-claude/src/claude.ts#L690-L695) - the ports `Start` hands the session"
  - "[code://packages/agent-claude/test/agent-claude-task-output.test.ts](../../../../packages/agent-claude/test/agent-claude-task-output.test.ts) - the fake SDK feed"
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L43-L94 - `capture`
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L145-L184 - the path, the text and the terminal content
---

## Objective

A `Bash` result whose output Claude saved to a file keeps that output for its chat through `Start.terminalOutputs`.
It completes with a terminal named after its call, after the notice, which the host rebuilds from what it kept.
Every other result completes as it does today.

## Files

- `CREATE: packages/agent-claude/src/session/savedoutput.ts` - the path, the preview, the read, the keep and the content held by call id.
- `UPDATE: packages/agent-claude/src/session/context.ts:139-159` - `terminalOutputs` on the session's options, and `SessionContext` takes the new area.
- `UPDATE: packages/agent-claude/src/claude.ts:690-695` - hand `Start.terminalOutputs` to the session.
- `UPDATE: packages/agent-claude/src/session.ts:109-123` - build the area beside the others.
- `UPDATE: packages/agent-claude/src/session/query.ts:769-799` - read the saved output before `results` maps a `user` message.
- `UPDATE: packages/agent-claude/src/session/stream.ts:563-582` - add the held terminal content after the text.
- `CREATE: packages/agent-claude/test/agent-claude-saved-output.test.ts` - the cases below.
- `UPDATE: packages/sdk/test/conformance.test.ts` - one case that drives the host and subscribes to the terminal.
- `CREATE: packages/sdk/test/claude-saved-output.test.ts` - the same through the host, and after a restart.

## Steps

1. Write `savedPathOf`, which reads `persistedOutputPath` and `backgroundTaskId` under the SDK's `BashOutput` names.
2. Write `previewOf` with the reference's notice pattern, read from the result's first text.
3. Type the message as the SDK's `SDKUserMessage`, and its result block from that type.
4. Skip a subagent's message, a message without exactly one `tool_result`, and a call that is not `Bash`.
5. Skip a session with no `terminalOutputs`, and a session in a machine.
6. Read a regular file of at most 10 MB with Node's `stat` and `readFile`, and give up otherwise.
7. Give up for a call outside the running turn.
   Give up when the session closed or the running turn changed during the read.
8. Keep the output under the call's id, with code 0 on success and no code on an error.
9. Give up when the host did not keep it.
10. Hold the terminal content, named `uri(toolCallId)`, by call id until `results` takes it.
11. Await the read in the run loop before `results`, only for a message that names a saved output.
12. Add the held content after the text in `results`, and take it out of the map.
13. Write the cases.

## Validation

- A saved `Bash` result keeps the whole output with code 0, and its content names the terminal after the notice.
- A saved `Bash` result that failed keeps no code, and its content has no exit code.
- The preview comes from the result's first text, and a notice the pattern does not read gives none.
- An ordinary result, a subagent's result, a backgrounded command, another tool and a missing file keep nothing.
- A folder, a file over 10 MB and a session in a machine keep nothing.
- A host that keeps no outputs keeps nothing, and a host that could not keep one names no terminal.
- A turn that a client stops during the read keeps nothing.
- A result after its turn stops, with no turn running or with a later one running, keeps nothing.
- A session that closes during the read keeps nothing.
- Through the host, a subscribe to the terminal answers an exited state with the whole output.

## Resume

- **Done:** 2026-10-27, in `session/savedoutput.ts`, with the run loop and `results` changed as the Files say.
  `readSavedOutput` answers nothing for a message with no saved output, so only a saved `Bash` result waits.
  A result for a call outside the running turn keeps nothing, which is the reference's cancelled turn as this session sees it.
  The call's part is looked for in the running turn, as `results` looks for it.
  A stopped call's result can arrive while a later turn runs.
- **Reuse, 2026-10-27:** the module keeps no terminal of its own: the host keeps the output and rebuilds the terminal.
  It reads the fields under the SDK's `SDKUserMessage` and `BashOutput` types, and the read is Node's `stat` and `readFile`.
- **Found:** a result that arrives after its turn was stopped still reaches `results`, as before this task.
  `results` completes the stopped call with no turn id; this task keeps nothing for it.
