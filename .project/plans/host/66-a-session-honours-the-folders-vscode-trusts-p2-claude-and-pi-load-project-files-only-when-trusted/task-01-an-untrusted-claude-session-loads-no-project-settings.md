---
title: An untrusted Claude session loads no project settings or MCP servers
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L93-L171](../../../../packages/agent-claude/src/session/query.ts#L93-L171) - the `query()` options"
  - "[code://packages/agent-claude/src/mcp.ts#L22-L43](../../../../packages/agent-claude/src/mcp.ts#L22-L43) - `serversFor`"
---

## Objective

In a folder the host says is not trusted, the query is built with `settingSources` holding `user` only and `serversFor` reads no `.mcp.json` from that folder; in a trusted one, both are as today.

## Files

- `UPDATE: packages/agent-claude/src/session/query.ts:93-171` - `settingSources`; today it is unset, so the CLI loads `.claude/settings.json` and `.claude/settings.local.json` with their hooks, which run on the host, plus project skills, agents, commands and plugins.
- `UPDATE: packages/agent-claude/src/mcp.ts:22-43` - skip an untrusted directory; today every directory's `.mcp.json` is read, and its stdio servers run as commands.
- `UPDATE: packages/agent-claude/test/` - the cases below, against the fake SDK.

## Steps

1. Failing case first: a session in an untrusted folder holding `.mcp.json` with one server; the query the fake SDK receives has `settingSources: ['user']` and no such server. Today it has no `settingSources` and the server.
2. A trusted folder: as today.
3. The project's `CLAUDE.md` is not in what the session is told in an untrusted folder, which `settingSources: ['user']` already does; a case pins it.

## Validation

- The case fails on `e1c4ccc` and passes after.

## Resume
