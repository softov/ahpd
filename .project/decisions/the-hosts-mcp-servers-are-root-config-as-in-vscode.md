---
title: The host's MCP servers are the root config key `mcpServers`, as in VS Code, merged per session with its client plugins' servers
status: accepted
date: 2026-09-30
refs:
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/common/agentHostSchema.ts#L697-L760 - `AgentHostMcpServersConfigKey` and its schema
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/codex/codexAgent.ts#L2687-L2710 - root, then workspace, then client plugins; a client plugin wins a clash
  - "[code://packages/agent-acp/src/session.ts#L537-L549](../../packages/agent-acp/src/session.ts#L537-L549) - `mcpServers: []` on every open"
---

## Context

An ACP agent is opened with `mcpServers: []`, and the host has nowhere to keep MCP servers of its own.
VS Code keeps them in a root config key, and adds per session the servers of the client plugins the session has enabled.

## Decision

The host keeps its MCP servers in `config.json` under `mcpServers`, with VS Code's schema, and publishes it as a root config key through daemon/11.
A session's servers are that map merged with its enabled client plugins' servers, a client plugin winning a name clash, and they reach a backend in `Start`.

Source: Softov, 2026-09-30, asked where the host keeps its MCP servers: "both? because in plugin is from where vscode gatter that right?", then, told VS Code keeps a root key and adds client plugins' servers per session, chose "VS Code's shape".

## Consequences

Every backend can be given the same servers, and VS Code's setting for them maps onto this host.

## Options

- **A plugin option per backend**: each backend configured apart, and nothing VS Code's setting maps to.
- **The root key only**: client plugins' servers left out.
