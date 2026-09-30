---
title: The host's tools are an MCP server the host serves, and each agent plugin says whether its sessions take it
status: accepted
date: 2026-09-30
refs:
  - "[code://packages/sdk/src/types/agent.ts#L90-L168](../../packages/sdk/src/types/agent.ts#L90-L168) - `Start`, where the host's tools arrive"
  - "[code://packages/agent-acp/src/session.ts#L1145-L1147](../../packages/agent-acp/src/session.ts#L1145-L1147) - `startMcpServer` answers false"
---

## Context

A backend that cannot call the host's tools in-process, such as an ACP agent, needs them as an MCP server.
ACP v2 routes files and terminals through an MCP server too.

## Decision

The host serves `Start.tools` as one HTTP MCP server per session, on the daemon's listener with a per-session token, as a service any backend may use.
Each agent plugin has an option saying whether its sessions are given it; agent-acp's is on by default.

Source: Softov, 2026-09-30, asked "for the ACP bridge only, or a host service any backend may use?": "this was not suppose to be both? or maybe configurable."

## Consequences

The ACP bridge uses it now, and ACP v2's files and terminals land in the same service.
A backend that already has the tools in-process leaves the option off.

## Options

- **In the ACP bridge only**: a second MCP server to write for the next backend that needs one.
