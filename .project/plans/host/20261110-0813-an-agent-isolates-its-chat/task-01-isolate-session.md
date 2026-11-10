---
title: isolate_session moves the chat to a worktree
status: todo
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
- `UPDATE: packages/sdk/src/host/tooling.ts:2086` - the move asks for a new worktree for the chat.
- `UPDATE: packages/sdk/test` - the cases of the tool.
- `UPDATE: docs/sdk/TOOLS.md` - the tool.

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

