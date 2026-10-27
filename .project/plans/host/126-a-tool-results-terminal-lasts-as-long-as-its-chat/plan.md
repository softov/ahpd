---
title: A terminal a tool result names lasts as long as its chat
domain: host
status: built
priority: medium
created: 2026-10-27
revalidated: 2026-10-27
requires: []
changes:
  - specs/agent-backends.md
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/host/terminals.ts#L97-L152](../../../../packages/sdk/src/host/terminals.ts#L97-L152) - `commanded`, the `!` command's terminal, kept in memory until its session goes"
  - "[code://packages/sdk/src/host/terminals.ts#L196-L262](../../../../packages/sdk/src/host/terminals.ts#L196-L262) - `heldTerminals`, the terminal a backend opens, which `release` takes out of the map"
  - "[code://packages/sdk/src/host/terminals.ts#L60-L67](../../../../packages/sdk/src/host/terminals.ts#L60-L67) - `KEEP`, the scrollback a live terminal keeps"
  - "[code://packages/sdk/src/host/terminals.ts#L301-L315](../../../../packages/sdk/src/host/terminals.ts#L301-L315) - the fields every terminal state of this host carries"
  - "[code://packages/sdk/src/host/snapshots.ts#L93-L106](../../../../packages/sdk/src/host/snapshots.ts#L93-L106) - a terminal's snapshot: the live one, then the rebuilt one"
  - "[code://packages/sdk/src/host/history.ts#L298-L399](../../../../packages/sdk/src/host/history.ts#L298-L399) - `past`, the turns of a session that no backend session holds"
  - "[code://packages/sdk/src/host/snapshots.ts#L436](../../../../packages/sdk/src/host/snapshots.ts#L436) - a peer chat's transcript, read for its snapshot"
  - "[code://packages/sdk/src/host/sleep.ts#L318](../../../../packages/sdk/src/host/sleep.ts#L318) - a wake reads a lead chat's transcript"
  - "[code://packages/sdk/src/host/sleep.ts#L358](../../../../packages/sdk/src/host/sleep.ts#L358) - a wake reads each other chat's transcript"
  - "[code://packages/sdk/src/host/chatactions.ts#L1484-L1550](../../../../packages/sdk/src/host/chatactions.ts#L1484-L1550) - `chat/truncated`, which knows the turns it drops"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1380-L1414](../../../../packages/sdk/src/host/sessionmethods.ts#L1380-L1414) - `disposeChat`, where a chat goes"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L186-L188](../../../../packages/sdk/src/host/sessionmethods.ts#L186-L188) - a chat's record moves to another session"
  - "[code://packages/sdk/src/host/chatrecord.ts#L201-L236](../../../../packages/sdk/src/host/chatrecord.ts#L201-L236) - a chat a client closes stays in the record, marked closed"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1378-L1387](../../../../packages/sdk/src/host/lifecycle.ts#L1378-L1387) - the `!` command's claim: session, chat, turn and tool call"
  - "[code://packages/sdk/src/host/spawn.ts#L1044-L1053](../../../../packages/sdk/src/host/spawn.ts#L1044-L1053) - the terminal ports a backend gets on `Start`"
  - "[code://packages/sdk/src/sessions/sessions.ts#L583-L611](../../../../packages/sdk/src/sessions/sessions.ts#L583-L611) - one folder per session, which the store removes with the session"
  - "[code://packages/sdk/src/utils/jsonfile.ts#L53-L111](../../../../packages/sdk/src/utils/jsonfile.ts#L53-L111) - `readJson`, `readJsonObject` and `writeJsonAtomic`"
  - "[code://packages/sdk/src/host/channels.ts#L148-L170](../../../../packages/sdk/src/host/channels.ts#L148-L170) - `subagentChatUri`, a URI that names a chat and a tool call, and its reader"
  - "[code://packages/sdk/src/plugins/clientplugins.ts#L250](../../../../packages/sdk/src/plugins/clientplugins.ts#L250) - a file named by the hex hash of a URI"
  - "[code://packages/sdk/src/machines/terminals.ts#L544-L545](../../../../packages/sdk/src/machines/terminals.ts#L544-L545) - a shell under a pseudoterminal says `isPty: true`"
  - "[code://packages/server/src/commands/run.ts#L903](../../../../packages/server/src/commands/run.ts#L903) - the daemon gives its shells a pseudoterminal when it has one"
  - "[code://packages/sdk/src/types/agent.ts#L344-L363](../../../../packages/sdk/src/types/agent.ts#L344-L363) - `Start.outputTerminals`, the factory pattern a new port follows"
  - "[code://packages/sdk/src/types/agent.ts#L843-L865](../../../../packages/sdk/src/types/agent.ts#L843-L865) - `Agent.transcript`, a read that starts nothing"
  - "[code://packages/agent-claude/src/session/turns.ts#L389-L400](../../../../packages/agent-claude/src/session/turns.ts#L389-L400) - a `!` call names the host's terminal"
  - "[code://packages/agent-cofold/src/turns.ts#L476-L487](../../../../packages/agent-cofold/src/turns.ts#L476-L487) - the same in cofold"
  - "[code://packages/agent-acp/src/mapping.ts#L368](../../../../packages/agent-acp/src/mapping.ts#L368) - an ACP call names the terminal its agent opened"
  - npm://@microsoft/agent-host-protocol@1.0.0 - `TerminalState.content`, and the recipe that reads it back as one stream
  - https://github.com/microsoft/agent-host-protocol/blob/d4f542ea7e11fc8ec137fbe790925376f62031ac/docs/specification/terminal-channel.md#historical-terminal-results - a terminal a tool result names stays subscribable, and may be rebuilt from persisted output
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/common/nonPtyShellTerminalUri.ts#L17-L29 - the retained terminal's address
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L10647-L10718 - `_resolveRetainedTerminalState`, the rebuild
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L10785-L10803 - a subscribe tries the live terminal, then the retained one
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L883-L913 - `findNonPtyTerminalContent`, the call that names the address
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/sessionDatabase.ts#L236-L243 - the stored output, which goes with its turn
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/sessionDatabase.ts#L1135-L1182 - keep, delete, size and read
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/common/sessionDataService.ts#L19 - the 10 MB limit
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L29-L39 - the reference's `!` terminal stays alive and is not retained
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/test/node/agentSessionResidency.test.ts#L242 - a subscribed retained terminal keeps its session loaded
---

## Goal

A terminal that a tool result names stays subscribable for as long as its chat lasts, across a backend that sleeps and a daemon restart.
The host keeps the terminal's output in the session's own folder, under an address that names the chat.
A subscribe that no live terminal answers rebuilds the exited terminal from what was kept, as the reference host does.
The output goes with its turn when the chat is truncated, and with its chat or its session.
A backend can keep an output itself, and a backend that reads a transcript can ask which outputs are kept.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "type: 'terminal'" packages/*/src` - a `!` call names the host's terminal in agent-claude, agent-cofold and agent-acp, and an ACP call names a terminal its agent opened.
- `rg -n "\.transcript\?\.\(|\.transcript\(" packages/sdk/src` - the host reads a transcript in `past`, for a peer chat's snapshot, and twice in a wake.
- `rg -n "dropChat\(|kept.forget\(|moveChat\(" packages/sdk/src/host` - a chat goes in `disposeChat`, a session in its two removals, and a chat moves in `movedTo`.
- `rg -n "attachmentsDir" packages/sdk/src` - the session store keeps one folder for each session, and removes it with the session.
- `rg -n "isPty" packages/sdk/src/machines` - a shell under a pseudoterminal says `isPty: true`, and the daemon gives its shells one when it can.
- `parseNonPtyShellTerminalUri` in VS Code at `41c37d12` - the subscribe path, the rebuild and the residency test.
- `parseBangCommand` in VS Code at `41c37d12` - the reference keeps its `!` terminal alive and does not keep its output.

### Runtime path

```
a terminal starts -> the host names it ahp-terminal://shell/<base64url(chat)>/<key>
  -> while it is in `terminals`, the live terminal answers
the process exits -> { version, output, exitCode, isPty } goes to <session folder>/terminals/<hash(chat)>/<hash(key)>.json
a backend keeps an output -> Start.terminalOutputs.keep(key, output, exitCode) -> the call names uri(key)
subscribe, no live terminal -> the chat the address names -> its turns -> the call that names the address
  -> the kept output -> an exited TerminalState with the chat's claim
chat/truncated -> the outputs the dropped turns name go
disposeChat -> the chat's folder goes; a session's removal -> the session's folder goes
a chat moves -> its folder moves to the session it moved to
a transcript read -> the backend is handed the chat's outputs, and restores what is kept
```

### Gaps

- A terminal lives in memory only, so a call names nothing after a daemon restart, or after a backend releases its terminal.
- `Not found: a kept terminal output - searched terminals.ts, snapshots.ts, sessions.ts and types/sessions.ts in packages/sdk/src.`
- A backend has no port to keep an output, and a transcript read cannot ask which outputs are kept.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A terminal that a tool result names stays subscribable while its chat lasts, across a backend that sleeps and a daemon restart | https://github.com/microsoft/agent-host-protocol/blob/d4f542ea7e11fc8ec137fbe790925376f62031ac/docs/specification/terminal-channel.md#historical-terminal-results | all |
| The reference's design decides every part of this plan, and ahpd's code changes where it falls short of it | "why is anything still set aside if the patterns describe the implementation completely and unambiguously?" and "if ahpd is the incorrect part then our implementation should correct it", 2026-10-27 | all |
| Each part uses what Node, the protocol package or ahpd already has, and names it | "make sure we arent re implementing anything that node bun etc. already provide implementations for or we could make a wrapper of instead of a reimplementation of", 2026-10-27 | all |
| The address is `ahp-terminal://shell/<base64url(chat)>/<encoded key>`: the reference's `shell` authority, and the chat it names, encoded as `subagentChatUri` encodes a session | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/common/nonPtyShellTerminalUri.ts#L17-L29; [`code://packages/sdk/src/host/channels.ts#L148-L170`](../../../../packages/sdk/src/host/channels.ts#L148-L170) | 01 |
| The host defines these addresses, so `createTerminal` refuses a client's terminal under one with `-32003` | "give such a terminal a server-defined address", 2026-10-27; [`code://packages/sdk/src/host/terminals.ts#L405-L417`](../../../../packages/sdk/src/host/terminals.ts#L405-L417) | 01 |
| A subscribe reads the chat the address names and the session that holds that chat now, never a session written into the address | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L10647-L10666 | 02 |
| An output kept at exit goes to the session that holds the chat at that moment, so a chat that moved while its command ran keeps it | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L10647-L10666; [`code://packages/sdk/src/host/sessionmethods.ts#L186-L188`](../../../../packages/sdk/src/host/sessionmethods.ts#L186-L188) | 01 |
| A `!` command's terminal and a terminal a backend opens carry that address from their start, and keep their output when they exit | https://github.com/microsoft/agent-host-protocol/blob/d4f542ea7e11fc8ec137fbe790925376f62031ac/docs/specification/terminal-channel.md#historical-terminal-results; [`code://packages/agent-claude/src/session/turns.ts#L389-L400`](../../../../packages/agent-claude/src/session/turns.ts#L389-L400); [`code://packages/agent-acp/src/mapping.ts#L368`](../../../../packages/agent-acp/src/mapping.ts#L368) | 01 |
| The `!` command's key is its tool call, which its claim names; a backend's terminal has a key of its own | [`code://packages/sdk/src/host/lifecycle.ts#L1378-L1387`](../../../../packages/sdk/src/host/lifecycle.ts#L1378-L1387) | 01 |
| A terminal's text is the protocol's recipe in one place, for a `!` command's preview, a backend's read and the kept output | `npm://@microsoft/agent-host-protocol@1.0.0` - `TerminalState.content`: "`content.map(p => p.type === 'command' ? p.output : p.value).join('')`" | 01 |
| An output is kept as `{ version, output, exitCode, isPty }`, written with `writeJsonAtomic` and read with `readJsonObject`, and a file of another version is not read | [`code://packages/sdk/src/utils/jsonfile.ts#L53-L111`](../../../../packages/sdk/src/utils/jsonfile.ts#L53-L111) | 01 |
| An output is kept in the session's own folder, at `terminals/<hash(chat)>/<hash(key)>.json`, so the store's removal of a session takes its outputs | [`code://packages/sdk/src/sessions/sessions.ts#L583-L611`](../../../../packages/sdk/src/sessions/sessions.ts#L583-L611) | 01 |
| A file name is a hex SHA-256 hash, so a long chat URI, or a key with a character Windows refuses, still names a file | https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file; [`code://packages/sdk/src/plugins/clientplugins.ts#L250`](../../../../packages/sdk/src/plugins/clientplugins.ts#L250) | 01 |
| An output over 10 MB, counted in bytes, is not kept | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/common/sessionDataService.ts#L19 | 01 |
| A subscribe answers the live terminal first, and rebuilds only when no live terminal has the address | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L10785-L10803 | 02 |
| The rebuild needs the newest call a client saw run or finish whose content names the address, compared as the chat and the key the two names carry | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L883-L913 | 02 |
| A chat a client closed answers nothing, though its backend still holds the conversation | https://github.com/microsoft/agent-host-protocol/blob/d4f542ea7e11fc8ec137fbe790925376f62031ac/docs/specification/terminal-channel.md#historical-terminal-results; [`code://packages/sdk/src/host/chatrecord.ts#L201-L236`](../../../../packages/sdk/src/host/chatrecord.ts#L201-L236) | 02 |
| The output is the kept output, else the call's preview; a call that says it is truncated and has nothing kept is not rebuilt | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L10690-L10702 | 02 |
| The state has the call's title, one `unclassified` part, an exited lifecycle with the code, and a claim that names the session, the chat and the call | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L10703-L10718 | 02 |
| The state also has the 80 by 24 size, `supportsCommandDetection: false` and the flat `exitCode`, as every terminal state of this host has | [`code://packages/sdk/src/host/terminals.ts#L301-L315`](../../../../packages/sdk/src/host/terminals.ts#L301-L315) | 02 |
| The state's `isPty` is the one kept with the output, else the call's | [`code://packages/sdk/src/machines/terminals.ts#L544-L545`](../../../../packages/sdk/src/machines/terminals.ts#L544-L545); [`code://packages/server/src/commands/run.ts#L903`](../../../../packages/server/src/commands/run.ts#L903) | 02 |
| The exit code is the call's, else the one kept with the output, because an ACP call carries no `result` | [`code://packages/agent-acp/src/mapping.ts#L368`](../../../../packages/agent-acp/src/mapping.ts#L368) | 02 |
| A truncation takes the outputs that the dropped turns name in this chat, and leaves those a fork's turns name in the chat it came from | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/sessionDatabase.ts#L236-L243; [`code://packages/sdk/src/host/chatactions.ts#L1484-L1550`](../../../../packages/sdk/src/host/chatactions.ts#L1484-L1550) | 03 |
| A chat that a client disposes takes its outputs, and a session's removal takes its folder | https://github.com/microsoft/agent-host-protocol/blob/d4f542ea7e11fc8ec137fbe790925376f62031ac/docs/specification/terminal-channel.md#historical-terminal-results; [`code://packages/sdk/src/host/sessionmethods.ts#L1380-L1414`](../../../../packages/sdk/src/host/sessionmethods.ts#L1380-L1414) | 03 |
| A chat that moves takes its outputs to the session it moves to, and back when the move is refused | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L10647-L10666; [`code://packages/sdk/src/host/sessionmethods.ts#L186-L188`](../../../../packages/sdk/src/host/sessionmethods.ts#L186-L188) | 03 |
| A backend gets `Start.terminalOutputs` for its chat, with `uri(key)`, `has(key)` and `keep(key, output, exitCode)` | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/sessionDatabase.ts#L1135-L1182; [`code://packages/sdk/src/types/agent.ts#L344-L363`](../../../../packages/sdk/src/types/agent.ts#L344-L363) | 04 |
| A transcript read is handed the outputs of the chat it reads, at all four places the host reads one and in the rebuild | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2008-L2009; [`code://packages/sdk/src/host/history.ts#L298-L399`](../../../../packages/sdk/src/host/history.ts#L298-L399) | 04 |
| `Start.terminalOutputs` is absent, and nothing is kept, where the store keeps no folder for the session | [`code://packages/sdk/src/sessions/sessions.ts#L583-L611`](../../../../packages/sdk/src/sessions/sessions.ts#L583-L611) | 04 |
| `TERMINALS.md`, `AGENT.md`, `AHP.md`, the agent backends spec and a `0.14.1 - unreleased` changelog entry say what a retained terminal is | [`code://docs/sdk/TERMINALS.md#L74-L80`](../../../../docs/sdk/TERMINALS.md#L74-L80); [`code://CHANGELOG.md#L5`](../../../../CHANGELOG.md#L5) | 05 |
| Departure from the reference: its `!` terminal stays alive and is not kept, and here it is kept, because the rule names every terminal a tool result names | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L29-L39 | 01 |
| Departure from the reference: it keeps only terminals with no pseudoterminal and needs `isPty: false` on the call, and here the file says which, because the daemon runs a `!` command under a pseudoterminal when it can | [`code://packages/server/src/commands/run.ts#L903`](../../../../packages/server/src/commands/run.ts#L903); https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L883-L913 | 02 |
| Departure from the reference: it needs a `result` on the call, and here a call with none is rebuilt from what was kept, because an ACP call carries none | [`code://packages/agent-acp/src/mapping.ts#L368`](../../../../packages/agent-acp/src/mapping.ts#L368) | 02 |
| Departure from the reference: its address carries a session and a storage in a query for older builds, and here it carries none | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L10647-L10651 | 01 |
| Departure from the reference: a stored output is tied to its turn by a row, and here a truncation finds the outputs in the turns it drops | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/sessionDatabase.ts#L236-L243 | 03 |
| Departure from the reference: a subscribed retained terminal keeps its session loaded, and here a rebuild needs no backend, so a session sleeps as before | https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/test/node/agentSessionResidency.test.ts#L242 | 02 |

## Proposed architecture

- **Data flow** - a terminal's output goes from its live state to one JSON file in the session's folder when it exits.
  A backend's output goes there through `Start.terminalOutputs.keep`.
  A subscribe reads the file back into an exited `TerminalState`.
- **Event flow** - nothing new on the wire: a live terminal says `terminal/exited` as before.
  A rebuilt terminal is a snapshot with no actions after it.
- **State flow** - the file lives as long as its turn, its chat and its session, and moves with its chat.
- **Layer responsibilities** - sdk: the address, the files, the rebuild, the removals and the two ports.
  Backends: nothing changes for a `!` command or an ACP terminal, and claude/24 uses the port for its saved output.
- **Source-of-truth files** - `packages/sdk/src/host/outputs.ts`, which task 01 creates, and `packages/sdk/src/types/terminals.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A terminal's output is kept under an address that names its chat](task-01-a-terminals-output-is-kept.md) | done | - |
| [02 - A subscribe rebuilds an exited terminal from what was kept](task-02-a-subscribe-rebuilds-it.md) | done | 01 |
| [03 - A kept output goes with its turn, chat and session, and moves with its chat](task-03-it-goes-with-its-turn-chat-and-session.md) | done | 01 |
| [04 - A backend keeps an output, and reads which are kept](task-04-a-backend-keeps-and-reads-them.md) | done | 01 |
| [05 - The docs say what a retained terminal is](task-05-the-docs-say-what-it-is.md) | done | 02, 03, 04 |

## Risks and tradeoffs

- A write of up to 10 MB holds the event loop for a moment - `writeJsonAtomic` is the store's own writer.
  Only a backend's saved output comes near that size.
- A `!` command whose call names no terminal, as pi's does, leaves a file nothing names - it goes with its chat.
- A rebuild reads the chat's turns, from a transcript when no backend session holds the chat - `past` keeps that read.

## Resume state

- **Done so far:** built 2026-10-27; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** an address names the chat as this host holds it, and a subscribe never reads a session out of it.

## Final verification checklist

- [x] A `!` command's terminal is rebuilt after its live terminal is gone.
- [x] A host started again on the same store rebuilds a terminal that a transcript names.
- [x] A terminal a backend opened is rebuilt after its release.
- [x] A truncation, a disposed chat and a removed session take the outputs they hold, and a moved chat keeps its own.
- [x] A backend keeps an output through `Start.terminalOutputs`, and a transcript read is handed the chat's outputs.
- [x] `pnpm boundary`, `pnpm typecheck` and `pnpm build` end with no errors, and the suites that cover the host pass.
- [x] `plans/index.md` updated.
