---
title: The agent terminal tool
domain: host
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
requires:
  - plans/host/20261103-1620-a-shell-runs-vscodes-shell-integration/plan.md
changes:
  - specs/agent-backends.md
refs:
  - git://14beb809 - the commit of ahpd this plan was checked at
  - git://e7ada61c - MayCXC's branch `host/124-an-agents-shell-is-a-terminal-the-person-sees`; its `tools/shell.ts`, the call id, `overridesBuiltInTool` and the Claude and pi changes are ports to take, not to merge
  - "[code://packages/sdk/src/types/agent.ts#L82-L120](../../../../packages/sdk/src/types/agent.ts#L82-L120) - `BoundTool`, whose `run` gets no call id"
  - "[code://packages/sdk/src/types/host.ts#L981-L1122](../../../../packages/sdk/src/types/host.ts#L981-L1122) - `HostToolCommon`, `SessionHostTool` and `HostTool`"
  - "[code://packages/sdk/src/types/host.ts#L1137-L1318](../../../../packages/sdk/src/types/host.ts#L1137-L1318) - `ToolCall`, with no call id"
  - "[code://packages/sdk/src/host/tooling.ts#L465-L496](../../../../packages/sdk/src/host/tooling.ts#L465-L496) - `sessionToolsFor` and `contributingTo`, where a switch withholds tools"
  - "[code://packages/sdk/src/host/tooling.ts#L2248-L2283](../../../../packages/sdk/src/host/tooling.ts#L2248-L2283) - `offeredTools`, which binds a host tool for a backend"
  - "[code://packages/sdk/src/types/session.ts#L390-L418](../../../../packages/sdk/src/types/session.ts#L390-L418) - `CommandTerminal`, `Ran` and `RunCommand`: host/128's `run(toolCallId, opened)`, the pattern a host tool's call copies"
  - "[code://packages/sdk/src/host/terminals.ts#L109-L282](../../../../packages/sdk/src/host/terminals.ts#L109-L282) - `commanded` and `heldTerminals`, each with its own copy of the open block"
  - "[code://packages/agent-claude/src/session/turns.ts#L619-L661](../../../../packages/agent-claude/src/session/turns.ts#L619-L661) - a Claude call takes its terminal as soon as it opens"
  - "[code://packages/agent-claude/src/session/clienttools.ts#L38-L132](../../../../packages/agent-claude/src/session/clienttools.ts#L38-L132) - the `ahp` MCP server; the call id is read for client tools only"
  - "[code://packages/agent-claude/src/session/query.ts#L127-L131](../../../../packages/agent-claude/src/session/query.ts#L127-L131) - `denyOption`, which builds `disallowedTools`"
  - "[code://packages/agent-claude/src/session/asking.ts#L568-L575](../../../../packages/agent-claude/src/session/asking.ts#L568-L575) - `Bash` lines go through the terminal approval rules"
  - "[code://packages/agent-pi/src/tools.ts#L26-L110](../../../../packages/agent-pi/src/tools.ts#L26-L110) - `PI_TOOLS`, which drops a host tool named like pi's own, and `execute`, which has the call id"
  - "[code://packages/agent-cofold/src/tools.ts#L121-L143](../../../../packages/agent-cofold/src/tools.ts#L121-L143) - a cofold call has `ctx.callId`"
  - "[code://packages/sdk/src/tools/server.ts#L269-L278](../../../../packages/sdk/src/tools/server.ts#L269-L278) - the MCP endpoint ACP agents call, with no call id"
  - "[code://packages/sdk/src/vscoderootconfig.ts#L208-L214](../../../../packages/sdk/src/vscoderootconfig.ts#L208-L214) - `canvasesEnabled`, the entry to copy"
  - "[code://packages/sdk/src/host/gate.ts#L85-L86](../../../../packages/sdk/src/host/gate.ts#L85-L86) - the grants of a client's own terminal methods"
  - "[code://packages/sdk/src/host/spawn.ts#L945-L984](../../../../packages/sdk/src/host/spawn.ts#L945-L984) - `getAutoApproval`"
  - "[code://packages/agent-acp/src/session/handlers.ts#L373-L438](../../../../packages/agent-acp/src/session/handlers.ts#L373-L438) - a terminal for a session in a machine runs through `computers.how`"
  - npm://@anthropic-ai/claude-agent-sdk@^0.3.301 - `Options.toolAliases` in `sdk.d.ts`, with the example `{ Bash: 'mcp__workspace__bash' }`
  - npm://@earendil-works/pi-coding-agent@^1.3.0 - a custom tool of a built-in tool's name replaces it, in `_refreshToolRegistry`
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/copilot/copilotShellTools.ts#L55-L302 - `ShellManager`
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/copilot/copilotShellTools.ts#L413-L816 - `createShellTools`, the six tools and their descriptions
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/shared/shellCommandExecution.ts - `executeShellCommand`: the sentinel, the endings and `prepareOutputForModel`
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/copilot/copilotSessionLauncher.ts#L1396-L1403 - the switch, never under Windows
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L2268-L2289 - a call shows its shell's terminal as soon as the shell is given to it
---

## Goal

An agent runs its shell commands in terminals the session holds, so the person can watch a command, type into it and stop it.
The tools are VS Code's agent terminal tool: six tools, turned on by the root config key `enableCustomTerminalTool`.
Each call shows its terminal while the command runs.
Claude and pi use these tools in place of their own shell, and cofold and ACP agents get them beside their own.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "overridesBuiltInTool|enableCustomTerminalTool|toolAliases" packages/*/src` - nothing on main.
- `rg -n "run\?\.\(input\)|bound.run\(" packages/agent-*/src` - every backend calls a host tool with its input only.
- `git log 122ec4fe4431..origin/main` on VS Code's shell tool files - no change since the fork read them.
- host/128 and host/129 merged after the fork.
  A `!` call names its terminal through `opened`, and a tool result's terminal lasts as long as its chat.

### Runtime path

```
model calls bash -> backend runs the bound tool with { toolCallId, opened } -> shell manager gets or opens a shell
  -> opened(terminal) -> backend puts the terminal on its call -> command execution waits for the D mark or the sentinel
  -> the output for the model, cut to the cap
```

### Gaps

- A host tool does not know which call it runs for.
- No tool is marked to replace a backend's own tool.
- No host tool opens a shell to sit in, and no code waits for a command's end in a shell.
- The root config has no `enableCustomTerminalTool`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Every backend that takes a host tool is offered the six tools | Softov, 2026-10-27 | 03 |
| ACP agents get them too, and their call shows no terminal, because an MCP call carries no call id | Softov, 2026-11-03, chose "Offer them to ACP too" | 03 |
| The descriptions stay word for word, and ahpd builds what they promise: `mode=async`, the cap and `ask_user` | Softov, 2026-10-27 | 02, 03 |
| A host tool's call shows its terminal through an `opened` callback the backend gives, as a `!` call does | (defaulted: host/128's `RunCommand`, the sibling pattern; the fork's rewrite of the backend's actions is not taken) | 01 |
| `overridesBuiltInTool` is the reference's mark. Claude disallows `Bash` and aliases it to `mcp__ahp__bash`; pi takes the host's `bash` in place of its own | git://e7ada61c, and `toolAliases` in npm://@anthropic-ai/claude-agent-sdk@^0.3.301 | 01 |
| `mcp__ahp__bash` lines go through the terminal approval rules as `Bash` lines do | [code://packages/agent-claude/src/session/asking.ts#L568-L575](../../../../packages/agent-claude/src/session/asking.ts#L568-L575) | 01 |
| The tools are off by default and never offered under Windows | [copilotSessionLauncher.ts#L1396-L1403](https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/copilot/copilotSessionLauncher.ts#L1396-L1403) | 03 |
| A shell for a session in a machine runs in the machine through `computers.how`, and gets no integration | (defaulted: a command outside the machine would escape it); Softov, 2026-11-03, on integration | 02 |
| A command ends at its `D` mark when the terminal detects commands, and at the sentinel otherwise | [shellCommandExecution.ts#L191-L201](https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/shared/shellCommandExecution.ts#L191-L201) | 02 |
| A finished command's output is its `command` part's `output` | (defaulted: on main a marked command is a `command` part with its own output) | 02 |
| The output for the model is cut to 60 KB, the number the description says | Softov, 2026-10-27, "builds what they promise" | 02 |
| Each tool acts as the person who sent the turn, with the grant of the client terminal method it matches | [code://packages/sdk/src/host/gate.ts#L85-L86](../../../../packages/sdk/src/host/gate.ts#L85-L86) | 03 |
| An agent's shell opens through the same open block as `heldTerminals`, and the two copies become one | (defaulted: a third copy is on the fork) | 02 |

## Proposed architecture

- **Data flow** - the tool's input goes to the shell manager, which writes the command to a shell and returns the command's output.
- **Event flow** - `opened` fires when a shell is given to a call. The backend sends `chat/toolCallContentChanged` with the terminal.
- **State flow** - the shell manager holds the session's shells, each idle, busy or exited, with the call it serves.
- **Layer responsibilities** - `@ahpd/sdk`: the call context, the shell manager, the command execution and the tools · the backends: pass the call and show the terminal.
- **Source-of-truth files** - [`code://packages/sdk/src/host/terminals.ts`](../../../../packages/sdk/src/host/terminals.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a host tool knows its call](task-01-a-host-tool-knows-its-call.md) | implemented | - |
| [02 - an agent's shells run its commands](task-02-an-agents-shells-run-its-commands.md) | implemented | 01 |
| [03 - the six tools behind the switch](task-03-the-six-tools-behind-the-switch.md) | implemented | 01, 02 |

## Risks and tradeoffs

- An ACP agent's call of the host's `bash` shows no terminal. The terminal is on the root list, with the session's claim.
- A shell in a machine has no marks, so its commands end at the sentinel, which is slower to see.
- The descriptions name `mode=async` and `ask_user` before plans D and C build them. Release this plan with those two, or after them.
- Claude's own `Bash` is disallowed only when the host's `bash` is offered, so a session with the switch off keeps Claude's own shell.

## Resume state

- **Done so far:** tasks 01, 02 and 03, on `build/agents/09cc9b8d`. A host tool's `run` gets its call id and an `opened` callback; Claude, pi and cofold put the terminal on the call and keep it in the completion; a marked `bash` replaces Claude's and pi's own shell, and Claude reads `mcp__ahp__bash` lines by the terminal rules. The host keeps a shell manager per session: an idle shell is reused, a busy one is skipped, an exited one is dropped, and a new one opens through the one open block `commanded` and `heldTerminals` also use. A command ends at its `D` mark or at the sentinel, on the alternate screen, on the shell's exit, or on its timeout, and its output is the `command` part cut to 60 KB. A shell for a session in a machine runs through `computers.how`. The six tools are offered behind `enableCustomTerminalTool`, never on Windows and never without a terminal store, each checking the grant of the client terminal method it matches; `docs/sdk/TERMINALS.md` and `.project/specs/agent-backends.md` describe them.
- **Next action:** none in this plan. The final checklist's daemon run - a Claude session running `bash` with the switch on - is the one item no gate covers.
- **Open questions:** none.
- **Watch out for:** do not merge the fork branch. Its `shells.ts` counts output; main reads a `command` part. A store with no screen answers `whenAltBuffer` at once, so the execution reads `isInAltBuffer()` when that wait settles instead of taking the answer itself as the alternate screen. `packages/sdk/test/fixtures/wire.jsonl` is dirty from the test runs and its `git checkout` is denied in this session.

## Final verification checklist

- [x] `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- [x] The sdk, server, agent-claude, agent-pi, agent-cofold and agent-acp suites pass, one at a time.
- [ ] On a test daemon with `enableCustomTerminalTool` on, a Claude session runs `bash`, and the call shows the terminal while the command runs.
