---
title: A Bash result too large to send is a terminal
domain: claude
status: built
priority: medium
created: 2026-10-27
revalidated: 2026-10-27
requires: [plans/host/126-a-tool-results-terminal-lasts-as-long-as-its-chat/plan.md]
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L769-L799](../../../../packages/agent-claude/src/session/query.ts#L769-L799) - the run loop hands each `user` message and its `tool_use_result` to `results`"
  - "[code://packages/agent-claude/src/session/stream.ts#L480-L640](../../../../packages/agent-claude/src/session/stream.ts#L480-L640) - `results`, which makes a `tool_result` the call's completion"
  - "[code://packages/agent-claude/src/session/turns.ts#L389-L400](../../../../packages/agent-claude/src/session/turns.ts#L389-L400) - the `!` command's terminal content, the shape this plan copies"
  - "[code://packages/agent-claude/src/transcript.ts#L250-L315](../../../../packages/agent-claude/src/transcript.ts#L250-L315) - `buildTurns`, where a call read back from Claude's transcript gets its result"
  - "[code://packages/agent-claude/src/claude.ts#L537-L554](../../../../packages/agent-claude/src/claude.ts#L537-L554) - `transcript`, the read of a session that no backend session holds"
  - "[code://packages/agent-claude/src/claude.ts#L599-L601](../../../../packages/agent-claude/src/claude.ts#L599-L601) - `spawn`, which only a session in a machine has"
  - "[code://packages/sdk/src/types/terminals.ts#L310-L333](../../../../packages/sdk/src/types/terminals.ts#L310-L333) - `TerminalOutputs`, the outputs the host keeps for a chat"
  - "[code://packages/sdk/src/types/agent.ts#L355-L363](../../../../packages/sdk/src/types/agent.ts#L355-L363) - `Start.terminalOutputs`"
  - "[code://packages/sdk/src/types/agent.ts#L843-L865](../../../../packages/sdk/src/types/agent.ts#L843-L865) - `Agent.transcript` and the outputs it is handed"
  - "[code://.project/specs/agent-backends.md#L133](../../../../.project/specs/agent-backends.md#L133) - a machine path is not a folder the host has"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.301 - `BashOutput.persistedOutputPath` and `backgroundTaskId` (`sdk-tools.d.ts:3282-3346`); `SDKUserMessage.tool_use_result`; `getSessionMessages` returns no `toolUseResult`
  - npm://@microsoft/agent-host-protocol@1.0.0 - `ToolResultTerminalContent` and `TerminalCommandResult.truncated` (`src/types/channels-chat/state.ts:1704-1738`)
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts - `ClaudeTerminalOutputs`: `capture`, `restore`, the notice pattern and the terminal content
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeSdkMessageRouter.ts#L77-L87 - the capture ends before the completion is mapped
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L383-L391 - the terminal content goes after the result's text
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2008-L2009 - the restore runs on every read of a transcript
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/CONTEXT.md - "Claude retained shell output", the reference's own account of it
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/common/sessionDataService.ts#L19 - `MAX_TERMINAL_OUTPUT_BYTES`, the read limit
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/files/common/files.ts#L1632-L1645 - that limit is 10 MB for the string `agent-host`
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/test/node/claudeTerminalOutput.test.ts - the reference's cases
  - https://github.com/microsoft/agent-host-protocol/blob/d4f542ea7e11fc8ec137fbe790925376f62031ac/docs/specification/terminal-channel.md#historical-terminal-results - a retained terminal stays subscribable, and may be rebuilt from persisted output
---

## Goal

A `Bash` call whose output is too large to send shows the output in a terminal in its content, as VS Code does.
Claude then gives the model a notice in place of the output, and writes the whole output to a file.
The call keeps the notice as its text, and the host keeps the whole output for the call's chat.
The call names the terminal the host rebuilds from that output.
A call read back from Claude's transcript names the terminal again.
Every other result stays as it is.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "tool_use_result" packages/agent-claude/src` - the run loop hands it to `results`, which reads it only for a task that Claude creates.
- `rg -n "terminalOutputs" packages/sdk/src` - host 126 hands a backend the outputs the host keeps for its chat, and the outputs of the chat a transcript read reads.
- `rg -n "transcript: async" packages/agent-claude/src` - one read of Claude's transcript, which every host read goes through.
- `persistedOutputPath` in a real transcript - the structured `stdout` holds the first 30,000 bytes, and only the notice holds the 2 KB preview.
- `claudeTerminalOutput` in the VS Code tree at `41c37d12` - the capture, the restore, and their callers in the router, the agent and the saved chat reader.

### Runtime path

```
CLI -> SDK user message: tool_result notice + tool_use_result.persistedOutputPath
  -> query.ts run loop -> read the file, at most 10 MB
  -> Start.terminalOutputs.keep(toolCallId, output, 0 or no code)
  -> stream.ts results -> chat/toolCallComplete content: [notice text, terminal named uri(toolCallId)]
  -> a client subscribes to the terminal -> the host rebuilds an exited TerminalState from what it kept
transcript read -> buildTurns gives the call the notice -> the call names uri(toolCallId) again where has(toolCallId)
```

### Gaps

- A `Bash` result too large to send shows the notice and its 2 KB preview, and nothing more.
- A call read back from Claude's transcript carries only the notice, because `getSessionMessages` returns no `toolUseResult`.
- A backend has no store for a chat's data - host 126 adds `Start.terminalOutputs`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A `Bash` call whose output Claude saved to a file shows that output in a terminal in its content | "the call shows its terminal in its content, as the reference does", 2026-10-27 | 01 |
| The reference's design decides every part of this plan, and ahpd's code changes where it falls short of it | "why is anything still set aside if the patterns describe the implementation completely and unambiguously?" and "if ahpd is the incorrect part then our implementation should correct it", 2026-10-27 | all |
| Only a `Bash` result gets a terminal; every other tool, Claude's own `PowerShell` tool included, stays as it is | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L19-L20 | 01 |
| The file is the one `tool_use_result.persistedOutputPath` names; a result with a `backgroundTaskId` gets no terminal, because its file is a snapshot of a command that still runs | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L145-L156 | 01 |
| A subagent's result, whose `parent_tool_use_id` is set, and a message with more than one `tool_result` get no terminal | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L48-L59 | 01 |
| The file is read before the completion goes out, so the completion carries the terminal | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeSdkMessageRouter.ts#L77-L87 | 01 |
| A file over 10 MB, a file that is not there and a read that fails leave the call as it is | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L72 and #L87-L89; https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/files/common/files.ts#L1641-L1645 | 01 |
| A turn that is cancelled, or a session that closes, while the file is read keeps nothing and gets no terminal | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L62-L64 and #L81-L84 | 01 |
| The whole output is kept with `Start.terminalOutputs.keep(toolCallId, output, exitCode)`, with 0 for a result that succeeded and no code for one that failed | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L76-L80; [`code://packages/sdk/src/types/terminals.ts#L310-L333`](../../../../packages/sdk/src/types/terminals.ts#L310-L333) | 01 |
| A host that keeps no outputs, or could not keep this one, leaves the call as it is | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L87-L89 | 01 |
| The content is `{ type: 'terminal', resource: uri(toolCallId), title, isPty: false, result: { exitCode?, preview?, truncated: true } }`, after the result's text | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L166-L184; [`code://packages/agent-claude/src/session/turns.ts#L389-L400`](../../../../packages/agent-claude/src/session/turns.ts#L389-L400) | 01 |
| The title is the call's `displayName`, which is `Bash` | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L60 | 01 |
| The preview is the notice's own, read with the reference's pattern from the result's first text; a notice the pattern does not match gives a terminal with no preview | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L22-L27 and #L158-L170 | 01 |
| A completed `Bash` call read back from the transcript names its terminal after its text where `outputs.has(toolCallId)`, with the same content | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L117-L142 | 02 |
| The restore runs after the turns are built, on every read of Claude's transcript that the host hands outputs to | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2008-L2009 | 02 |
| Each part uses what Node, the SDK, the protocol package or ahpd already has: Node's `stat` and `readFile`, the SDK's `SDKUserMessage` and `BashOutput`, the protocol's `ToolResultTerminalContent`, and the host's `TerminalOutputs` | "make sure we arent re implementing anything that node bun etc. already provide implementations for or we could make a wrapper of instead of a reimplementation of", 2026-10-27 | 01 |
| The path goes to Node's `stat` and `readFile` as Claude wrote it, so a Windows path is read as a Windows path | https://nodejs.org/api/fs.html#file-paths | 01 |
| A session in a machine gets no terminal, because Claude's file is inside the machine and a machine path is not a folder this host has | [`code://.project/specs/agent-backends.md#L133`](../../../../.project/specs/agent-backends.md#L133); [`code://packages/agent-claude/src/claude.ts#L599-L601`](../../../../packages/agent-claude/src/claude.ts#L599-L601) | 01 |
| Departure from the reference: it stores the output, then deletes it if the turn was stopped; here the turn is checked first, so nothing is kept to delete | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L81-L84 | 01 |
| Departure from the reference: it logs a read that failed and a notice it does not match, and a Claude session here has no log | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L88 and #L169 | 01 |
| The README, `docs/sdk/AHP.md` and a `0.14.1 - unreleased` changelog entry say what such a call shows | [`code://CHANGELOG.md#L5`](../../../../CHANGELOG.md#L5); [`code://docs/sdk/AHP.md#L270`](../../../../docs/sdk/AHP.md#L270) | 03 |

## Proposed architecture

- **Data flow** - the run loop reads the file a `Bash` result names, keeps it through `Start.terminalOutputs`, and holds the terminal content by call id.
  `results` takes the content and adds it after the text.
  A transcript read adds the same content to each completed `Bash` call whose output is kept.
- **Event flow** - nothing new: the call's `chat/toolCallComplete` names the terminal, and the host answers a subscribe to it.
- **State flow** - the host keeps the output with its turn, its chat and its session, as host 126 says.
- **Layer responsibilities** - agent-claude: `session/savedoutput.ts`, the run loop, `results` and the transcript read.
  sdk: nothing here; host 126 gives the port.
- **Source-of-truth files** - `packages/agent-claude/src/session/savedoutput.ts`, which task 01 creates.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A Bash result Claude saved shows its terminal](task-01-a-bash-result-claude-saved-shows-its-terminal.md) | done | - |
| [02 - A Bash call read back keeps its terminal](task-02-a-bash-call-read-back-keeps-its-terminal.md) | done | 01 |
| [03 - The docs and the changelog say what such a call shows](task-03-the-docs-say-what-such-a-call-shows.md) | done | 01 |

## Risks and tradeoffs

- A read of up to 10 MB holds the run loop - the reference waits the same way.
  Nothing reads a larger file.
- The run loop reads a path that the CLI's message names - a `Bash` call on this host can print that file anyway.
  A session in a machine reads no file.

## Resume state

- **Done so far:** built 2026-10-27; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** a `user` message with no saved output reaches `results` with no wait, as every other result always did.

## Final verification checklist

- [x] A live `Bash` result that Claude saved names a terminal with the whole output, and the terminal has exited.
- [x] An ordinary result, a subagent's result, a backgrounded command, another tool and a missing file get none.
- [x] A `Bash` call read back from the transcript names the terminal its live call had.
- [x] `pnpm boundary`, `pnpm typecheck` and `pnpm build` end with no errors, and the suites that cover the change pass.
- [x] `plans/index.md` updated.
