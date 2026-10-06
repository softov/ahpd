---
title: The README says it, and an ACP agent runs a VS Code tool by hand
status: todo
depends: [task-03-the-acp-session-takes-the-clients-tools.md]
layer: "agent-acp docs"
refs:
  - "[code://packages/agent-acp/README.md](../../../../packages/agent-acp/README.md) - where the host tools are described"
  - "[code://packages/agent-acp/src/session/opening.ts#L127-L145](../../../../packages/agent-acp/src/session/opening.ts#L127-L145) - the `hostTools` option, which client tools ride on"
---

## Objective

The README says an ACP session is offered its clients' tools through the host tool server, under `hostTools`, what `toolsChanged` does with each value and its `notify` default, and what an agent that ignores the notification and never lists again misses; one real ACP agent has run one VS Code tool through ahpd.

## Files

- `UPDATE: packages/agent-acp/README.md` - the client tools paragraph and the `toolsChanged` option.

## Steps

1. Write the paragraph in the README's style.
2. Run ahpd with an ACP agent that takes HTTP MCP servers, connect VS Code, and have the agent call one of VS Code's tools.
3. Note in Resume the agent, the `name` and `title` it reported, whether `_meta['claudecode/toolUseId']` arrived, and whether it listed again after `list_changed`.

## Validation

- By hand: the call shows as VS Code's in VS Code, VS Code runs it, and the agent's next message uses the result.
- `pnpm wire` against the capture of that run validates the `toolClientExecution` entry.

## Resume
