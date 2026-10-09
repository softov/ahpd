---
title: A switched-off server does not reach the agent
status: done
depends: [task-02-a-client-plugin-lists-its-parts.md]
layer: sdk, agent-claude
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1001-L1040](../../../../packages/sdk/src/host/chatactions.ts#L1001-L1040) - `session/customizationToggled`"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/shared/customizationEnablementGate.ts#L113-L165 - the server's own enablement, under its plugin's
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L918-L946 - Claude's `deniedServers`
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/common/state/protocol/channels-session/reducer.ts#L359-L384 - a toggle finds a part inside its container's `children`
---

## Objective

A client plugin's MCP server that `childEnablement` or a toggle switches off does not reach the agent.
A switched-off plugin takes all its servers with it.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:1001-1040` - a toggle on a client plugin, or on one of its servers, is answered here.
- `UPDATE: packages/sdk/src/host/tooling.ts` - a part's decision, `mcpFor` without a switched-off server, and the names held back.
- `UPDATE: packages/sdk/src/host/spawn.ts` - the held-back names reach the backend's `Start`.
- `UPDATE: packages/sdk/src/types/agent.ts` - `Start.deniedMcpServers`.
- `UPDATE: packages/sdk/src/types/session.ts` - `SessionOptions.deniedMcpServers`, which is how they reach a backend.
- `UPDATE: packages/agent-claude/src/claude.ts` - the names are handed on to the session.
- `UPDATE: packages/agent-claude/src/session/query.ts` - they go in the CLI's own `settings`, beside a preset's.
- `UPDATE: packages/agent-claude/src/session/servers.ts` - a server named by the file that declares it.
- `UPDATE: packages/sdk/test/host-tools.test.ts` - a server switched off and on, and a plugin switched off.
- `UPDATE: packages/sdk/test/host-harness.test.ts` - a live Claude session switches one off by that name.
- `UPDATE: packages/agent-claude/test/agent-claude-declarations.test.ts` - the names reach the CLI's settings.

## Steps

1. Find a toggled id among each client plugin's `children` when no entry has it.
2. Leave a switched-off server out of `mcpFor`.
3. Pass Claude a switched-off plugin server in `deniedServers`.
4. Apply a toggle on a live Claude session with `toggleMcpServer`.

## Validation

- A test toggles a server off and on, and reads the servers the agent gets each time.
- A test switches the plugin off and finds none of its servers.
- The gates pass.

## Resume

- **Status:** done.
- **Done:** [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) reads a part's decision off its `enablement`, most specific first. `toggleClientPlugin` now answers what the id named: nothing, the plugin itself, or one of its servers. A toggle on a server rewrites that part in a new list, so what a client was already sent is not rewritten under it.
- **Left out:** `mcpFor` skips a server a client switched off, so it is never declared to an agent. A plugin switched off is out of the set whole, which already took every server of it with it. `deniedMcpServers` names the others, and `spawn` hands the names down; `Start.deniedMcpServers` carries them to a backend.
- **Named apart:** `chatactions` asks the backend about a server of a plugin and never about the plugin, which the backend has never heard of. `serverNamed` in [`code://packages/agent-claude/src/session/servers.ts`](../../../../packages/agent-claude/src/session/servers.ts) reads both ids a server has: this session's own `mcp:<name>`, and `<file uri>#mcp=<encoded name>` for a plugin's.
- **Answered not refused:** the backend is offered a live switch and its answer is dropped. A backend with no live switch does not undo the decision, which is this host's. Refusing would put the client's switch back over a change that takes effect at the next send. A plugin itself is never offered to the backend at all.
- **Restarted:** a chat is started again when a server of one of its plugins is switched, not only when a directory moves. The set a chat began with is now its directories and the names held back from them. A server switched off and switched on again both reach the agent at the next send.
- **Claude:** [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts) merges the names into the CLI's own `settings.deniedMcpServers` as `{ serverName }` entries, beside whatever a preset put in `settings` rather than instead of it. A directory the CLI opens itself can hold a server the host left out, and this is the list the CLI reads.
- **Files:** three of the task's lines named files or ranges that have moved. `chatactions.ts:870-889` was the working directory's case, and the toggle case is at `1001-1040`. `packages/agent-claude/src/session.ts:2175-2220` is a file this repository no longer has, split into `session/query.ts` and `session/servers.ts`. `tooling.ts` was right and needed more than `mcpFor`: the parts' decisions and the set a chat began with are both there.
- **Tests:** [`code://packages/sdk/test/host-tools.test.ts`](../../../../packages/sdk/test/host-tools.test.ts) toggles a plugin's server off and on, and reads the servers and the held-back names the backend was handed each time. Another case announces a plugin with a server already off in `childEnablement`, and finds the same answer. A third switches the plugin off and finds none of its servers. A fourth toggles a server on the echo backend, which has no live switch. It finds no refusal said back, and the name held back at the next send. [`code://packages/sdk/test/host-harness.test.ts`](../../../../packages/sdk/test/host-harness.test.ts) switches one off on a live Claude session, named by the file that declares it with an escaped name in the fragment. [`code://packages/agent-claude/test/agent-claude-declarations.test.ts`](../../../../packages/agent-claude/test/agent-claude-declarations.test.ts) reads the CLI's settings back.
- **Not covered:** a server switched off at session start is not in the backend's declared set, so a later sign-in re-declaration cannot bring it back. The hold-back list is what keeps it from running either way.
- **Gates:** pass. `pnpm install`, `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck` and `pnpm boundary` are clean, and the full `vitest` run reports 264 files and 4630 tests passed.
