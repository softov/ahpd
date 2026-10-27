---
title: A Bash call read back keeps its terminal
status: blocked
depends: [task-01-a-bash-result-claude-saved-shows-its-terminal.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/claude.ts#L540-L543](../../../../packages/agent-claude/src/claude.ts#L540-L543) - `transcript`, the read of a session that no backend session holds"
  - "[code://packages/agent-claude/src/transcript.ts#L250-L315](../../../../packages/agent-claude/src/transcript.ts#L250-L315) - where a call read back gets its result, the notice alone"
  - "[code://packages/sdk/src/host/history.ts#L298-L397](../../../../packages/sdk/src/host/history.ts#L298-L397) - `past`, the host's only reader of a transcript"
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L113-L142 - `restore`
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2008-L2009 - the restore on every read of a transcript
---

## Objective

A completed `Bash` call read back from Claude's transcript carries the terminal content its live call had, when its output is still kept.
A call with no kept output, and a call of any other tool, stay as they are.

## Files

- `UPDATE: packages/agent-claude/src/claude.ts:540-543` - attach the kept output to the turns that `transcript` reads.
- `UPDATE: packages/agent-claude/src/session/savedoutput.ts` - the attach, which builds the same content as the live call.
- `UPDATE: packages/agent-claude/test/agent-claude-saved-output.test.ts` - the cases below.

## Steps

1. Find each completed `Bash` call in the turns that `transcript` reads, as the reference's `restore` does.
2. Look up the call's kept output in the store that the plan's open question names.
3. Add the terminal content after the call's text, with the notice's preview and the call's result.
4. Write the cases.

## Validation

- A `Bash` call with kept output carries the terminal content after its text.
- A `Bash` call with no kept output, and a `Read` call, keep their text alone.

## Resume

- **Blocked:** on the plan's open question 1, which asks where a call read back finds its output.
  On the answer the plan has now, no read of a transcript has any output to find.
