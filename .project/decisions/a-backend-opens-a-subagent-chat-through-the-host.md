---
title: A backend opens a subagent chat through the host
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/types/agent.ts#L93](../../packages/sdk/src/types/agent.ts#L93) - `Start`, where the new seam goes"
  - "[code://packages/sdk/src/host.ts#L1151-L1165](../../packages/sdk/src/host.ts#L1151-L1165) - `sessionOfChat`, which owns what a chat URI means"
  - "[code://packages/sdk/src/host.ts#L774-L784](../../packages/sdk/src/host.ts#L774-L784) - `chatSummary`, the host's record of a chat"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/agentSideEffects.ts#L1002-L1080 - the reference host, not its backends, opens the subagent chat and links it from the spawning call
---

## Context

A Claude subagent runs inside one tool call of the main turn, and its messages arrive on the same stream tagged with `parent_tool_use_id`. Today they are drawn in the main turn. The protocol has a place for them: a read-only worker chat whose `origin` is the spawning tool call, linked from that call by a `subagent` tool-result content. Something has to name that chat, announce it, start its turn and write the link.

## Decision

`Start` gains a seam through which a backend asks the host for a subagent chat, naming the spawning tool call and the subagent's title, agent name, description and prompt. The host names the chat, announces it with `session/chatAdded`, starts its turn with the prompt, appends the `subagent` content to the spawning call, and hands back an emitter for that chat and a way to end its turn. Source: (defaulted: the reference host does this in its side effects, not in a backend; Softov may overturn it).

## Consequences

The host stays the only thing that knows a chat URI's shape, and a second backend with subagents (ACP) uses the same seam. The `Start` type gains an optional member. A backend without it keeps drawing subagent output inline.

## Options

- **The backend builds the chat URI and emits to it.** No SDK change, but every backend would learn the URI spelling and the chat lifecycle, and the host would learn of the chat only from actions on a channel it never opened.
