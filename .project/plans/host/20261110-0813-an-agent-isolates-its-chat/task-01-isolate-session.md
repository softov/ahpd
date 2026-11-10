---
title: isolate_session moves the chat to a worktree
status: implemented
depends: []
layer: "sdk, docs"
refs:
  - "[code://packages/sdk/src/tools/session.ts#L406](../../../../packages/sdk/src/tools/session.ts#L406) - `sessionTools`"
  - "[code://packages/sdk/src/host/tooling.ts#L2086](../../../../packages/sdk/src/host/tooling.ts#L2086) - `setWorkspace`"
---

## Objective

ahpd serves VS Code's `isolate_session`: no input, a confirmation, and the calling chat moved to a new worktree at its turn's end.

## Files

- `UPDATE: packages/sdk/src/tools/session.ts:406` - `isolate_session` joins the session tools.
- `UPDATE: packages/sdk/src/types/host.ts` - `ToolSession.multipleDirectories`, `HostTool.topLevelChatOnly` and `ToolCall.workingDirectories`.
- `UPDATE: packages/sdk/src/host/tooling.ts:2086` - the move asks for a new worktree for the chat, and the session tools are shaped for a provider.
- `UPDATE: packages/sdk/test` - the cases of the tool.
- `UPDATE: docs/sdk/TOOLS.md` - the tool.
- `UPDATE: docs/sdk/BUILD-A-HOST.md` - the session tools count and names.
- `UPDATE: docs/server/MCP.md` - `isolate_session` among the tools `/mcp` does not offer.
- `UPDATE: docs/updates/v0_15.md` - one line under *Unreleased*, *Daemon*.

## Steps

1. Copy VS Code's schema, description and confirmation text at 171e90619.
2. Refuse any input, and a call with no active turn, in VS Code's words.
3. Offer the tool only to a top-level chat of an agent with `multipleDirectories`, in one local git folder.
4. Ask the person with VS Code's confirmation before you keep the move.
5. Keep the move for the calling chat with a new worktree, through the one-chat move of the required plan.
6. Copy the session's `worktreeIncludeFiles` into the new worktree.

## Validation

- A call moves the chat at the turn's end, and a continuation turn runs in the worktree.
- The host refuses a call with an input, and a call from a subagent.
- `pnpm typecheck`, then the sdk suite.

## Resume

- `isolate_session` is in `sessionTools` after `set_workspace`, with VS Code's name, description, title and empty schema, and `destructiveHint` set.
- The run refuses a call with no active turn, and a call with any input, in VS Code's words.
- It refuses a chat with no single local Git folder, or one the host cannot cut a worktree from.
- The tool is deferred, withheld from a worker chat, and offered only where the session's agent has `multipleDirectories`, which `isEnabledForSession` answers.
- `ToolSession.multipleDirectories`, `HostTool.topLevelChatOnly` and `ToolCall.workingDirectories()` join `packages/sdk/src/types/host.ts`.
- `toolSession` and `shapedDefinition` take the provider too, because a session's start binds its tools before the host holds the session.
- The move is the required plan's one-chat move.
- `setWorkspace(folder, true)` keeps it to the turn's end, and the worktree is cut with the session's `worktreeIncludeFiles` from `decided`.
- Departure: `ToolDefinition` has no `confirmationTitle` or `confirmationMessage`.
- Those two of VS Code's strings are not carried, and the backend's own policy asks as it does for `set_workspace`.
- `sessiontools.test.ts` covers the definition and the four refusals.
- `host-tools.test.ts` moves a chat into a real worktree with its include-file, and asserts the continuation turn.
- It also asserts that an agent with `multipleDirectories: false` is not offered the tool.
- Validation passed: typecheck clean, and the two new cases pass.
- The sdk suite's and the server suite's failures are the TMPDIR ones this plan names.

