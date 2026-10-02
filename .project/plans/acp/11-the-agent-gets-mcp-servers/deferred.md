---
title: The agent gets the host's MCP servers - deferred
date: 2026-10-02
---

- A host tool called over the MCP endpoint runs without a host-side approval; an ACP agent asks its own permission first. Whether a tool whose `effects` call for approval is refused or routed through the session's permission flow needs a decision.
- Client plugins' MCP servers: this host has no client plugin customizations, so only the host's half of the merge exists.
- By hand: Codex over ACP listing and calling a host tool.
