---
title: A Bash result too large to send is a terminal
domain: claude
status: planned
priority: medium
created: 2026-10-27
revalidated: 2026-10-27
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L769-L791](../../../../packages/agent-claude/src/session/query.ts#L769-L791) - the run loop hands each `user` message and its `tool_use_result` to `results`"
  - "[code://packages/agent-claude/src/session/stream.ts#L480-L628](../../../../packages/agent-claude/src/session/stream.ts#L480-L628) - `results`, which makes a `tool_result` the call's completion"
  - "[code://packages/agent-claude/src/session/workers.ts#L423-L445](../../../../packages/agent-claude/src/session/workers.ts#L423-L445) - `outputOf`, the output terminal a background shell writes into"
  - "[code://packages/agent-claude/src/session/workers.ts#L724-L731](../../../../packages/agent-claude/src/session/workers.ts#L724-L731) - `closeOutputs`, which ends those terminals when the session closes"
  - "[code://packages/agent-claude/src/session/turns.ts#L389-L400](../../../../packages/agent-claude/src/session/turns.ts#L389-L400) - the `!` command's terminal content, the shape this plan copies"
  - "[code://packages/agent-claude/src/session.ts#L273-L314](../../../../packages/agent-claude/src/session.ts#L273-L314) - `close`, which a sleep and a restart call as well as a delete"
  - "[code://packages/agent-claude/src/transcript.ts#L250-L315](../../../../packages/agent-claude/src/transcript.ts#L250-L315) - `buildTurns`, where a call read back from Claude's transcript gets its result"
  - "[code://packages/agent-claude/src/claude.ts#L540-L543](../../../../packages/agent-claude/src/claude.ts#L540-L543) - `transcript`, the read of a session that no backend session holds"
  - "[code://packages/agent-claude/src/claude.ts#L588-L590](../../../../packages/agent-claude/src/claude.ts#L588-L590) - `spawn`, which only a session in a machine has"
  - "[code://packages/sdk/src/host/terminals.ts#L257-L369](../../../../packages/sdk/src/host/terminals.ts#L257-L369) - `heldOutputs`: no process, `isPty: false`, at most `KEEP` characters"
  - "[code://packages/sdk/src/types/agent.ts#L169-L578](../../../../packages/sdk/src/types/agent.ts#L169-L578) - `Start`, which hands a backend no store of the session's own"
  - "[code://packages/sdk/src/types/sessions.ts#L195-L455](../../../../packages/sdk/src/types/sessions.ts#L195-L455) - `SessionStore`, the host's record of a session, `attachmentsDir` included"
  - "[code://packages/sdk/src/host/sleep.ts#L136-L178](../../../../packages/sdk/src/host/sleep.ts#L136-L178) - a sleep closes the backend session, and a wake seeds the next one from the transcript"
  - "[code://packages/sdk/src/host/history.ts#L298-L397](../../../../packages/sdk/src/host/history.ts#L298-L397) - `past`, which reads a session that no backend session holds from its transcript"
  - "[code://packages/sdk/src/host/lifecycle.ts#L746-L749](../../../../packages/sdk/src/host/lifecycle.ts#L746-L749) - a restart seeds the new backend session with the old one's turns"
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
The call keeps the notice as its text, and gets an exited terminal that holds the whole output.
Every other result stays as it is.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "tool_use_result" packages/agent-claude/src` - the run loop hands it to `results`, which reads it only for a task that Claude creates.
- `rg -n "outputTerminals" packages/agent-claude/src packages/sdk/src` - a background shell is the only backend use, and the host owns the channel.
- `rg -n "past\(" packages/sdk/src/host` - the host reads a transcript only for a session that no backend session holds.
- `rg -n "attachmentsDir|records\(" packages/sdk/src/types` - the host keeps files for each session, and `Start` hands a backend no store.
- `persistedOutputPath` in a real transcript - the structured `stdout` holds the first 30,000 bytes, and only the notice holds the 2 KB preview.
- `claudeTerminalOutput` in the VS Code tree at `41c37d12` - the capture, the restore, and their callers in the router, the agent and the saved chat reader.

### Runtime path

```
CLI -> SDK user message: tool_result notice + tool_use_result.persistedOutputPath
  -> query.ts run loop -> read the file, at most 10 MB
  -> outputTerminals.create({ title, chat }) -> replace(output) -> finalize(0 or no code)
  -> stream.ts results -> chat/toolCallComplete content: [notice text, terminal]
  -> a client subscribes to ahp-terminal:/<uuid> -> an exited TerminalState with the output
session close -> the terminal goes, as a background shell's does
transcript read -> the call has the notice and no terminal (task 02)
```

### Gaps

- A `Bash` result too large to send shows the notice and its 2 KB preview, and nothing more.
- `Not found: a store a backend writes a chat's data in - searched Start, SessionStore, attachmentsDir and records in packages/sdk/src/types.`
- A call read back from Claude's transcript carries only the notice, because `getSessionMessages` returns no `toolUseResult`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A `Bash` call whose output Claude saved to a file shows that output in a terminal in its content | "the call shows its terminal in its content, as the reference does", 2026-10-27 | 01 |
| Only a `Bash` result gets a terminal; every other tool, Claude's own `PowerShell` tool included, stays as it is | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L19-L20 | 01 |
| The file is the one `tool_use_result.persistedOutputPath` names; a result with a `backgroundTaskId` gets no terminal, because its file is a snapshot of a command that still runs | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L145-L156 | 01 |
| A subagent's result, whose `parent_tool_use_id` is set, and a message with more than one `tool_result` get no terminal | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L48-L59 | 01 |
| The file is read before the completion goes out, so the completion carries the terminal | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeSdkMessageRouter.ts#L77-L87 | 01 |
| A file over 10 MB, a file that is not there and a read that fails leave the call as it is | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L72 and #L87-L89; https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/files/common/files.ts#L1641-L1645 | 01 |
| A turn that is cancelled, or a session that closes, while the file is read gets no terminal | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L62-L64 and #L81-L84 | 01 |
| The output goes into an output terminal from `outputTerminals.create({ title, chat })`, with no process behind it | [`code://packages/agent-claude/src/session/workers.ts#L430-L445`](../../../../packages/agent-claude/src/session/workers.ts#L430-L445) | 01 |
| The terminal takes the whole output with `replace`, then `finalize(0)` for a result that succeeded and `finalize()` with no code for one that failed | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L177-L179; [`code://packages/sdk/src/types/terminals.ts#L284-L291`](../../../../packages/sdk/src/types/terminals.ts#L284-L291) | 01 |
| The content is `{ type: 'terminal', resource, title, isPty: false, result: { exitCode?, preview?, truncated: true } }`, after the result's text | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L166-L184; [`code://packages/agent-claude/src/session/turns.ts#L389-L400`](../../../../packages/agent-claude/src/session/turns.ts#L389-L400) | 01 |
| The title is the call's `displayName`, which is `Bash` | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L60 | 01 |
| The preview is the notice's own, read with the reference's pattern; a notice the pattern does not match gives a terminal with no preview | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L22-L27 and #L167-L170 | 01 |
| The terminal stays until the session closes, as a background shell's does, because `Start` hands a backend no store to keep a chat's data in | [`code://packages/agent-claude/src/session/workers.ts#L724-L731`](../../../../packages/agent-claude/src/session/workers.ts#L724-L731); [`code://packages/sdk/src/types/agent.ts#L169-L578`](../../../../packages/sdk/src/types/agent.ts#L169-L578) | 01 |
| A session in a machine gets no terminal, because Claude's file is inside the machine and a machine path is not a folder this host has | [`code://.project/specs/agent-backends.md#L133`](../../../../.project/specs/agent-backends.md#L133); [`code://packages/agent-claude/src/claude.ts#L588-L590`](../../../../packages/agent-claude/src/claude.ts#L588-L590) | 01 |
| Gap against the reference: it keeps the output in the chat's database, so the output outlives a restart; here the output goes with the session's terminal | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L76-L80 | 01 |
| Gap against the reference: an output terminal keeps the last 200,000 characters, so a longer output shows its end and not its whole | [`code://packages/sdk/src/host/terminals.ts#L60-L67`](../../../../packages/sdk/src/host/terminals.ts#L60-L67) | 01 |
| Gap against the reference: it logs a read that failed and a notice it does not match, and a Claude session here has no log | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeTerminalOutput.ts#L88 and #L169 | 01 |
| The README, `docs/sdk/AHP.md`, `docs/sdk/TERMINALS.md` and a `0.14.1 - unreleased` changelog entry say what such a call shows | [`code://CHANGELOG.md#L5`](../../../../CHANGELOG.md#L5); [`code://docs/sdk/AHP.md#L270`](../../../../docs/sdk/AHP.md#L270) | 03 |

## Proposed architecture

- **Data flow** - the run loop reads the file a `Bash` result names into an output terminal, and holds the terminal content by call id.
  `results` takes the content and adds it after the text.
- **Event flow** - the output terminal says `terminal/cleared`, `terminal/data` and `terminal/exited` on its own channel, before the call's `chat/toolCallComplete` names it.
- **State flow** - the session holds each such terminal until it closes, as `closeOutputs` holds a background shell's.
- **Layer responsibilities** - agent-claude: all of it, in a new `session/savedoutput.ts` and the run loop. sdk: nothing changes.
- **Source-of-truth files** - `packages/agent-claude/src/session/savedoutput.ts`, which task 01 creates.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A Bash result Claude saved shows its terminal](task-01-a-bash-result-claude-saved-shows-its-terminal.md) | todo | - |
| [02 - A Bash call read back keeps its terminal](task-02-a-bash-call-read-back-keeps-its-terminal.md) | blocked | 01 |
| [03 - The docs and the changelog say what such a call shows](task-03-the-docs-say-what-such-a-call-shows.md) | todo | 01 |

## Risks and tradeoffs

- A read of up to 10 MB holds the run loop - the reference waits the same way.
  Nothing reads a larger file.
- A restart in this process carries a call to a new session, and the call names a terminal the old session closed - open question 1.
- The run loop reads a path that the CLI's message names - a `Bash` call on this host can print that file anyway.
  A session in a machine reads no file.

## Resume state

- **Done so far:** planned 2026-10-27.
- **Next action:** [task-01-a-bash-result-claude-saved-shows-its-terminal.md](task-01-a-bash-result-claude-saved-shows-its-terminal.md).
- **Open questions:**
  1. Where does a `Bash` call read back from Claude's transcript find its output, so that task 02 can attach the terminal as the reference does?
     On the answer above, the output lives in the terminal of the session that read it, and the session's close takes it.
     The host reads a transcript only for a session that no backend session holds, as after a sleep or a daemon restart.
     So task 02 finds no output in any of those reads.
     A restart in this process also leaves a carried call naming a terminal that is gone.
     Proposed: the reference's design, where the host keeps the output for each chat and rebuilds the exited terminal on a subscribe.
     That is a change to the sdk, outside agent-claude.
     Within agent-claude alone, these terminals can stay until the session is removed, as a `!` command's terminal does.
     The agent then holds each call's terminal for a call read back, and a daemon restart still loses them.
- **Watch out for:** a `user` message with no saved output reaches `results` with no wait, as every other result always did.

## Final verification checklist

- [ ] A live `Bash` result that Claude saved gets a terminal with the whole output, and the terminal has exited.
- [ ] An ordinary result, a subagent's result, a backgrounded command, another tool and a missing file get none.
- [ ] A `Bash` call read back from the transcript carries the terminal its live call had.
- [ ] `pnpm boundary`, `pnpm typecheck`, `pnpm test` and `pnpm build` end with no errors.
- [ ] `plans/index.md` updated.
