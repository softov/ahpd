---
title: A Bash call read back keeps its terminal
status: done
depends: [task-01-a-bash-result-claude-saved-shows-its-terminal.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/claude.ts#L537-L554](../../../../packages/agent-claude/src/claude.ts#L537-L554) - `transcript`, the read of a session that no backend session holds"
  - "[code://packages/agent-claude/src/transcript.ts#L250-L315](../../../../packages/agent-claude/src/transcript.ts#L250-L315) - where a call read back gets its result, the notice alone"
  - "[code://packages/sdk/src/types/agent.ts#L843-L865](../../../../packages/sdk/src/types/agent.ts#L843-L865) - the outputs the host hands a transcript read"
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L113-L142 - `restore`
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2008-L2009 - the restore on every read of a transcript
---

## Objective

A completed `Bash` call read back from Claude's transcript carries the terminal content its live call had, when its output is still kept.
A call with no kept output, a call that did not complete, and a call of any other tool stay as they are.

## Files

- `UPDATE: packages/agent-claude/src/claude.ts:537-554` - restore the turns that `transcript` reads, with the outputs the host hands it.
- `UPDATE: packages/agent-claude/src/session/savedoutput.ts` - `restoreSavedOutputs`, which builds the same content as the live call.
- `UPDATE: packages/agent-claude/test/agent-claude-saved-output.test.ts` - the cases below.
- `UPDATE: packages/sdk/test/claude-saved-output.test.ts` - a host started again on the same store.

## Steps

1. Find each completed `Bash` call in the turns that `transcript` reads, as the reference's `restore` does.
2. Ask the read's outputs whether they keep the call's output.
3. Add the terminal content after the call's text, with the notice's preview and the call's result.
4. Write the cases.

## Validation

- A `Bash` call with kept output carries the terminal content after its text, and a failed one carries no code.
- A `Bash` call with no kept output, a cancelled call and a `Read` call keep their text alone.
- A host started again on the same store reads the call back with its terminal.
- A subscribe to that terminal rebuilds the output.
- A host whose store kept nothing reads the call back with its text alone.

## Resume

- **Done:** 2026-10-27, after host 126 gave a transcript read the outputs of the chat it reads.
