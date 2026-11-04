---
title: The six tools behind the switch
status: implemented
depends:
  - task-01-a-host-tool-knows-its-call.md
  - task-02-an-agents-shells-run-its-commands.md
layer: "@ahpd/sdk tools"
refs:
  - "[code://packages/sdk/src/host/tooling.ts#L465-L496](../../../../packages/sdk/src/host/tooling.ts#L465-L496) - `contributingTo`, where the switch goes"
  - "[code://packages/sdk/src/vscoderootconfig.ts#L208-L214](../../../../packages/sdk/src/vscoderootconfig.ts#L208-L214) - the entry to copy"
  - "[code://packages/sdk/src/tools/index.ts#L24-L56](../../../../packages/sdk/src/tools/index.ts#L24-L56) - `hostTools`"
  - "[code://packages/sdk/src/tools/session.ts#L312-L314](../../../../packages/sdk/src/tools/session.ts#L312-L314) - `allowed`, the grant check"
  - "[code://packages/sdk/src/host/gate.ts#L85-L86](../../../../packages/sdk/src/host/gate.ts#L85-L86) - the client terminal grants"
  - git://e7ada61c - the fork's `tools/shell.ts` and its `shell-tools.test.ts` and `shell-call-terminal.test.ts`
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/copilot/copilotShellTools.ts#L413-L816 - the six tools and their descriptions
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/common/copilotCliConfig.ts#L234-L247 - the key's schema
---

## Objective

The host offers VS Code's six shell tools, with their names, schemas, descriptions and answers, when the root config's `enableCustomTerminalTool` is `true`.
They are never offered under Windows.
Each tool checks the grant of the client terminal method it matches, as the person who sent the turn.

## Files

- `CREATE: packages/sdk/src/tools/shell.ts` - the six tools, from the fork, on the task 02 shell manager.
- `UPDATE: packages/sdk/src/tools/index.ts:24-56` - `hostTools` includes them.
- `UPDATE: packages/sdk/src/vscoderootconfig.ts:208-214` - `enableCustomTerminalTool`, after `canvasesEnabled`, and the header list of keys the host acts on.
- `UPDATE: packages/sdk/src/host/tooling.ts:465-496` - `contributingTo` withholds the six tools unless the key is `true` and the platform is not Windows.
- `CREATE: packages/sdk/test/shell-tools.test.ts` - from the fork, fitted to main.
- `CREATE: packages/sdk/test/shell-call-terminal.test.ts` - from the fork, fitted to the `opened` callback.
- `UPDATE: docs/sdk/TERMINALS.md` - the agent terminal tool and its switch.
- `UPDATE: .project/specs/agent-backends.md` - which backends replace their own shell.

## Steps

1. Copy `tools/shell.ts` from `e7ada61c`, and keep VS Code's descriptions word for word.
2. Run each tool through the task 02 shell manager and command execution.
3. Check `terminal:create` before a shell opens, and the matching grant for read, write, shut down and list.
4. Add the key to `vscoderootconfig.ts` with `default: false`.
5. Withhold the six tools in `contributingTo` when the key is not `true` or the platform is Windows.
6. Add the tools to `hostTools`.
7. Fit the fork's two test files to main, and run them.
8. Write the docs and the spec lines.

## Validation

- `shell-tools.test.ts`: the tools are not offered until the key is `true`, and never under Windows.
- `shell-tools.test.ts`: the tool refuses a person without `terminal:create`.
- `shell-tools.test.ts`: `read_bash`, `write_bash`, `bash_shutdown` and `list_bash` act on the call's shell; `powershell` on a bash host fails with `wrong_shell`.
- `shell-call-terminal.test.ts`: a call shows its terminal while the command runs, and keeps it after the exit.
- `pnpm --filter @ahpd/sdk test` passes.

## Resume

Built on `build/agents/09cc9b8d`, after tasks 01 and 02.
`tools/shell.ts` carries the six tools on the task 02 manager, with the reference's schemas and descriptions word for word: `bash` (or `powershell`, by `shellOf()`) plus `read_`, `write_`, `_shutdown` and `list_`, and the other shell's primary answering with the name of the right tool.
Each is marked `overridesBuiltInTool`; the primary asks `terminal:create`, write `terminal:input`, read `terminal:output`, shutdown `terminal:dispose`, and `list_` asks none, all as the person who sent the turn.
`enableCustomTerminalTool` is declared in `vscoderootconfig.ts` with `default: false`, and `contributingTo` withholds the six names unless it is `true`, the platform is not Windows, and the host has a terminal store; `hostTools` adds them, and every call's `ToolCall` now has `shells()`.
A command that goes to the background or enters the alternate screen keeps its shell busy through `hold`.
A command that times out releases its shell, as in the reference.
`bash_shutdown` ends a shell and takes its terminal off the root list.
`test/shell-tools.test.ts` and `test/shell-call-terminal.test.ts` cover the Validation, and `packages/agent-claude/test/agent-claude-host-shell-tool.test.ts` covers Claude's disallowed `Bash` and its `mcp__ahp__bash` alias.
Docs are `docs/sdk/TERMINALS.md` and `.project/specs/agent-backends.md`.
One thing task 02 left: a store with no screen answers `whenAltBuffer` at once, so the execution reads `isInAltBuffer()` when the wait settles rather than treating the answer itself as the alternate screen; `shell-manager.test.ts` covers a screenless store running to its sentinel.
